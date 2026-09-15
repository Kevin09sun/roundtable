import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Integration tests that exercise Row Level Security on `issues` (see
 * supabase/migrations/20260914110000_create_issues_schema.sql) against the
 * REAL hosted Supabase project (not a mock).
 *
 * Same fixture pattern as sessions-rls.integration.test.ts (see that file's
 * header comment for the full rationale): three fixed, pre-seeded
 * throwaway accounts read from env vars, skipping this whole suite cleanly
 * when they're absent rather than failing. A DEDICATED subject per test
 * group, for the same reason as that file: tutor_subjects has one row per
 * (tutor, subject), so two test groups needing a different "who is the
 * tutor" answer for the same tutor cannot share a subject.
 *
 * The central thing under test here is the privacy rule that makes this
 * table different from sessions: issues_select is `raised_by = auth.uid()
 * OR is_admin()`, NOT "either participant of the pairing" -- a tutee's
 * report about their tutor must not be readable by that tutor. See the
 * migration header before "fixing" any test that looks surprising here.
 *
 * Cleanup: issues.pairing_id is ON DELETE CASCADE, so deleting a tracked
 * pairing in afterAll also removes every issue raised against it -- there
 * is no separate issue-id tracking array. Deletion order is still
 * pairings, then tutor_subjects, then subjects (subject_id is ON DELETE
 * RESTRICT from tutor_subjects).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.local) to run the issues RLS integration tests."
  )
}

const rawFixtureEnv = {
  userA: {
    email: process.env.RT_TEST_USER_A_EMAIL,
    password: process.env.RT_TEST_USER_A_PASSWORD,
  },
  userB: {
    email: process.env.RT_TEST_USER_B_EMAIL,
    password: process.env.RT_TEST_USER_B_PASSWORD,
  },
  admin: {
    email: process.env.RT_TEST_ADMIN_EMAIL,
    password: process.env.RT_TEST_ADMIN_PASSWORD,
  },
}

const hasFixtureEnv = Object.values(rawFixtureEnv).every((f) => Boolean(f.email && f.password))

if (!hasFixtureEnv) {
  console.warn(
    "Skipping issues RLS integration tests: RT_TEST_USER_A_EMAIL/PASSWORD, " +
      "RT_TEST_USER_B_EMAIL/PASSWORD, and RT_TEST_ADMIN_EMAIL/PASSWORD must all be " +
      "set (see .env.example) to run against the live Supabase project."
  )
}

const FIXTURES = rawFixtureEnv as {
  userA: { email: string; password: string }
  userB: { email: string; password: string }
  admin: { email: string; password: string }
}

function newClient(): SupabaseClient {
  return createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signIn(client: SupabaseClient, creds: { email: string; password: string }) {
  const { data, error } = await client.auth.signInWithPassword(creds)
  if (error || !data.user) {
    throw new Error(
      `Failed to sign in fixture ${creds.email}: ${error?.message ?? "no user returned"}`
    )
  }
  return data.user
}

;(hasFixtureEnv ? describe : describe.skip)("issues RLS", () => {
  const clientA = newClient()
  const clientB = newClient()
  const clientAdmin = newClient()

  let userA: { id: string }
  let userB: { id: string }
  let admin: { id: string }

  const subjectIds: string[] = []
  const pairingIdsToDelete: string[] = []

  async function createSubject(namePrefix: string): Promise<string> {
    const { data, error } = await clientAdmin
      .from("subjects")
      .insert({ name: `__rt_test_issues_${namePrefix}_${Date.now()}_${Math.random()}__` })
      .select("id")
      .single()
    if (error || !data) {
      throw new Error(`Failed to seed test subject: ${error?.message}`)
    }
    subjectIds.push(data.id)
    return data.id
  }

  async function offerSubject(tutorId: string, subjectId: string, maxTutees: number) {
    const { error } = await clientAdmin
      .from("tutor_subjects")
      .insert({ tutor_id: tutorId, subject_id: subjectId, max_tutees: maxTutees })
    if (error) {
      throw new Error(`Failed to seed tutor_subjects row: ${error.message}`)
    }
  }

  async function createPairing(
    tutorId: string,
    tuteeId: string,
    subjectId: string
  ): Promise<string> {
    const { data, error } = await clientAdmin
      .from("pairings")
      .insert({ tutor_id: tutorId, tutee_id: tuteeId, subject_id: subjectId })
      .select("id")
      .single()
    if (error || !data) {
      throw new Error(`Failed to seed test pairing: ${error?.message}`)
    }
    pairingIdsToDelete.push(data.id)
    return data.id
  }

  beforeAll(async () => {
    ;[userA, userB, admin] = await Promise.all([
      signIn(clientA, FIXTURES.userA),
      signIn(clientB, FIXTURES.userB),
      signIn(clientAdmin, FIXTURES.admin),
    ])
  })

  afterAll(async () => {
    if (pairingIdsToDelete.length > 0) {
      // ON DELETE CASCADE from issues.pairing_id takes any issue rows with
      // it.
      await clientAdmin.from("pairings").delete().in("id", pairingIdsToDelete)
    }
    if (subjectIds.length > 0) {
      await clientAdmin.from("tutor_subjects").delete().in("subject_id", subjectIds)
      await clientAdmin.from("subjects").delete().in("id", subjectIds)
    }

    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut(), clientAdmin.auth.signOut()])
  })

  it("does NOT let the OTHER participant read an issue they did not raise (privacy rule)", async () => {
    const subjectId = await createSubject("other_participant_denied")
    await offerSubject(userA.id, subjectId, 5)
    // userA is the tutor, userB is the tutee.
    const pairingId = await createPairing(userA.id, userB.id, subjectId)

    // userB (tutee) files a report about userA (tutor).
    const { data: issue, error: insertError } = await clientB
      .from("issues")
      .insert({
        pairing_id: pairingId,
        category: "no_show",
        description: "My tutor never showed up.",
        raised_by: userB.id,
      })
      .select("id")
      .single()
    expect(insertError).toBeNull()

    // userA is a participant of the SAME pairing but did not raise this
    // issue -- RLS filters the row out rather than raising, so assert the
    // denial explicitly (an empty array), not merely "no error".
    const { data: readData, error: readError } = await clientA
      .from("issues")
      .select("id")
      .eq("id", issue!.id)
    expect(readError).toBeNull()
    expect(readData).toEqual([])

    // Control: an admin CAN read it.
    const { data: adminRead, error: adminReadError } = await clientAdmin
      .from("issues")
      .select("id")
      .eq("id", issue!.id)
    expect(adminReadError).toBeNull()
    expect(adminRead).toHaveLength(1)

    // Control: the raiser can read their own issue.
    const { data: raiserRead, error: raiserReadError } = await clientB
      .from("issues")
      .select("id")
      .eq("id", issue!.id)
    expect(raiserReadError).toBeNull()
    expect(raiserRead).toHaveLength(1)
  })

  it("does NOT let a non-participant file an issue on someone else's pairing", async () => {
    const subjectId = await createSubject("non_participant_insert_denied")
    await offerSubject(admin.id, subjectId, 5)
    // admin is the tutor, userB is the tutee -- userA is part of neither.
    const pairingId = await createPairing(admin.id, userB.id, subjectId)

    const { data, error } = await clientA
      .from("issues")
      .insert({
        pairing_id: pairingId,
        category: "other",
        description: "Filed by someone not on this pairing.",
        raised_by: userA.id,
      })
      .select("id")
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it("does NOT let a participant set raised_by to another user", async () => {
    const subjectId = await createSubject("raised_by_spoof")
    await offerSubject(userA.id, subjectId, 5)
    const pairingId = await createPairing(userA.id, userB.id, subjectId)

    const { data, error } = await clientA
      .from("issues")
      .insert({
        pairing_id: pairingId,
        category: "scheduling",
        description: "Trying to file as someone else.",
        raised_by: userB.id,
      })
      .select("id")
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it("does NOT let a participant update or delete an issue, including their own; an admin can do both", async () => {
    const subjectId = await createSubject("participant_write_denied")
    await offerSubject(userA.id, subjectId, 5)
    const pairingId = await createPairing(userA.id, userB.id, subjectId)

    const { data: issue, error: insertError } = await clientA
      .from("issues")
      .insert({
        pairing_id: pairingId,
        category: "mismatch",
        description: "Filed by the raiser themselves.",
        raised_by: userA.id,
      })
      .select("id")
      .single()
    expect(insertError).toBeNull()

    // UPDATE: no error, but zero rows matched -- issues_update_admin has
    // no participant branch at all, so even the raiser is denied.
    const { data: updateData, error: updateError } = await clientA
      .from("issues")
      .update({ description: "tampered" })
      .eq("id", issue!.id)
      .select("id")
    expect(updateError).toBeNull()
    expect(updateData).toEqual([])

    // DELETE: same shape.
    const { data: deleteData, error: deleteError } = await clientA
      .from("issues")
      .delete()
      .eq("id", issue!.id)
      .select("id")
    expect(deleteError).toBeNull()
    expect(deleteData).toEqual([])

    // Confirm the row is genuinely untouched.
    const { data: stillThere } = await clientAdmin
      .from("issues")
      .select("description")
      .eq("id", issue!.id)
      .single()
    expect(stillThere?.description).toBe("Filed by the raiser themselves.")

    // Control: an admin CAN update it...
    const { data: adminUpdate, error: adminUpdateError } = await clientAdmin
      .from("issues")
      .update({ status: "in_progress" })
      .eq("id", issue!.id)
      .select("status")
      .single()
    expect(adminUpdateError).toBeNull()
    expect(adminUpdate?.status).toBe("in_progress")

    // ...and delete it.
    const { data: adminDelete, error: adminDeleteError } = await clientAdmin
      .from("issues")
      .delete()
      .eq("id", issue!.id)
      .select("id")
    expect(adminDeleteError).toBeNull()
    expect(adminDelete).toHaveLength(1)
  })

  it("lets an admin resolve an issue, setting status/resolution/resolved_by/resolved_at correctly", async () => {
    const subjectId = await createSubject("admin_resolve")
    await offerSubject(userA.id, subjectId, 5)
    const pairingId = await createPairing(userA.id, userB.id, subjectId)

    const { data: issue, error: insertError } = await clientA
      .from("issues")
      .insert({
        pairing_id: pairingId,
        category: "scheduling",
        description: "We can't agree on a meeting time.",
        raised_by: userA.id,
      })
      .select("id")
      .single()
    expect(insertError).toBeNull()

    const resolvedAt = new Date().toISOString()
    const { data: resolved, error: resolveError } = await clientAdmin
      .from("issues")
      .update({
        status: "resolved",
        resolution: "Set a fixed weekly meeting time for both.",
        resolved_by: admin.id,
        resolved_at: resolvedAt,
      })
      .eq("id", issue!.id)
      .select("status, resolution, resolved_by, resolved_at")
      .single()

    expect(resolveError).toBeNull()
    expect(resolved).toMatchObject({
      status: "resolved",
      resolution: "Set a fixed weekly meeting time for both.",
      resolved_by: admin.id,
    })
    expect(resolved?.resolved_at).not.toBeNull()
  })

  it("REJECTS marking an issue resolved without a resolution (issues_resolution_shape)", async () => {
    const subjectId = await createSubject("resolution_shape")
    await offerSubject(userA.id, subjectId, 5)
    const pairingId = await createPairing(userA.id, userB.id, subjectId)

    const { data: issue, error: insertError } = await clientA
      .from("issues")
      .insert({
        pairing_id: pairingId,
        category: "other",
        description: "Some other problem.",
        raised_by: userA.id,
      })
      .select("id")
      .single()
    expect(insertError).toBeNull()

    // status = 'resolved' with no resolution/resolved_by/resolved_at set
    // must be rejected by the DB CHECK constraint, even for an admin.
    const { data, error } = await clientAdmin
      .from("issues")
      .update({ status: "resolved" })
      .eq("id", issue!.id)
      .select("id")
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })
})
