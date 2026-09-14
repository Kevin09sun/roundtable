import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Integration tests that exercise Row Level Security AND the capacity /
 * uniqueness / request-sync triggers on `pairings`, against the REAL
 * hosted Supabase project (not a mock) -- see
 * supabase/migrations/20260910120000_create_pairings_schema.sql.
 *
 * Same fixture pattern as src/lib/supabase/rls.integration.test.ts and
 * intake-rls.integration.test.ts (see the former's header comment for the
 * full rationale): three fixed, pre-seeded throwaway accounts read from env
 * vars, skipping this whole suite cleanly when they're absent rather than
 * failing.
 *
 * This suite creates its own throwaway subjects, tutor_subjects,
 * tutee_requests, and pairings rows (never touching the three fixture
 * profiles themselves) and cleans them all up in afterAll, in dependency
 * order (pairings, then tutee_requests, then tutor_subjects, then
 * subjects -- subject_id and request_id are both referenced with ON DELETE
 * RESTRICT / SET NULL from other tables that must go first).
 *
 * A DEDICATED subject per test group (rather than one shared subject) is
 * deliberate: tutor_subjects has one row per (tutor, subject), so two test
 * groups that both need a *different* max_tutees or a *different*
 * "does this tutor offer the subject at all" answer for the same tutor
 * cannot share a subject without stepping on each other. Subjects are free
 * to create and this suite owns every one it creates outright.
 *
 * NOTE for anyone editing this file: the pairings it creates between userA
 * and userB are only cleaned up in this file's own afterAll (not
 * incrementally per test), so a real active A/B pairing exists in the
 * database for most of this file's run. That used to be able to race
 * rls.integration.test.ts's "does NOT let a user read another user's
 * profile row" test (profiles_select grants paired users mutual read
 * access -- 20260910130000_allow_paired_profile_read.sql), since Vitest
 * runs test files concurrently by default. It can't anymore:
 * vitest.config.ts sets `fileParallelism: false` specifically because
 * these integration suites all share one live Supabase project and
 * fixture set, so no two of them ever run at the same time. If that ever
 * changes, this file's lack of per-test cleanup is exactly the kind of
 * thing that would start colliding with siblings again.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.local) to run the pairings RLS integration tests."
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
    "Skipping pairings RLS integration tests: RT_TEST_USER_A_EMAIL/PASSWORD, " +
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

;(hasFixtureEnv ? describe : describe.skip)("pairings RLS + triggers", () => {
  const clientA = newClient()
  const clientB = newClient()
  const clientAdmin = newClient()

  let userA: { id: string }
  let userB: { id: string }
  let admin: { id: string }

  const subjectIds: string[] = []
  const pairingIdsToDelete: string[] = []
  const requestIdsToDelete: string[] = []

  async function createSubject(namePrefix: string): Promise<string> {
    const { data, error } = await clientAdmin
      .from("subjects")
      .insert({ name: `__rt_test_${namePrefix}_${Date.now()}_${Math.random()}__` })
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

  beforeAll(async () => {
    ;[userA, userB, admin] = await Promise.all([
      signIn(clientA, FIXTURES.userA),
      signIn(clientB, FIXTURES.userB),
      signIn(clientAdmin, FIXTURES.admin),
    ])
  })

  afterAll(async () => {
    if (pairingIdsToDelete.length > 0) {
      await clientAdmin.from("pairings").delete().in("id", pairingIdsToDelete)
    }
    if (requestIdsToDelete.length > 0) {
      await clientAdmin.from("tutee_requests").delete().in("id", requestIdsToDelete)
    }
    if (subjectIds.length > 0) {
      await clientAdmin.from("tutor_subjects").delete().in("subject_id", subjectIds)
      await clientAdmin.from("subjects").delete().in("id", subjectIds)
    }

    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut(), clientAdmin.auth.signOut()])
  })

  it("does NOT let a student insert a pairing, even one where they are the tutor", async () => {
    const subjectId = await createSubject("insert_denied")
    await offerSubject(userA.id, subjectId, 5)

    const { data, error } = await clientA
      .from("pairings")
      .insert({ tutor_id: userA.id, tutee_id: userB.id, subject_id: subjectId })
      .select("id")

    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it("lets a student read a pairing where they are the tutor, and one where they are the tutee", async () => {
    const subjectId = await createSubject("read_participant")
    await offerSubject(userA.id, subjectId, 5)

    const { data: pairing, error: insertError } = await clientAdmin
      .from("pairings")
      .insert({ tutor_id: userA.id, tutee_id: userB.id, subject_id: subjectId })
      .select("id")
      .single()
    expect(insertError).toBeNull()
    pairingIdsToDelete.push(pairing!.id)

    const { data: asTutor, error: tutorError } = await clientA
      .from("pairings")
      .select("id")
      .eq("id", pairing!.id)
    expect(tutorError).toBeNull()
    expect(asTutor).toHaveLength(1)

    const { data: asTutee, error: tuteeError } = await clientB
      .from("pairings")
      .select("id")
      .eq("id", pairing!.id)
    expect(tuteeError).toBeNull()
    expect(asTutee).toHaveLength(1)
  })

  it("does NOT let a student read a pairing they are not part of", async () => {
    const subjectId = await createSubject("read_denied")
    await offerSubject(admin.id, subjectId, 5)

    // admin is the tutor, userB is the tutee -- userA is part of neither.
    const { data: pairing, error: insertError } = await clientAdmin
      .from("pairings")
      .insert({ tutor_id: admin.id, tutee_id: userB.id, subject_id: subjectId })
      .select("id")
      .single()
    expect(insertError).toBeNull()
    pairingIdsToDelete.push(pairing!.id)

    // RLS filters the row out of the result set rather than raising a
    // permission error -- assert the denial explicitly (an empty array),
    // not just the absence of an error.
    const { data, error } = await clientA.from("pairings").select("id").eq("id", pairing!.id)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("REJECTS pairing a tutor for a subject they do not teach", async () => {
    const subjectId = await createSubject("no_offer")
    // Deliberately no tutor_subjects row for userA on this subject.

    const { data, error } = await clientAdmin
      .from("pairings")
      .insert({ tutor_id: userA.id, tutee_id: userB.id, subject_id: subjectId })
      .select("id")

    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it("REJECTS tutor_id = tutee_id", async () => {
    const subjectId = await createSubject("self_pair")
    await offerSubject(userA.id, subjectId, 5)

    const { data, error } = await clientAdmin
      .from("pairings")
      .insert({ tutor_id: userA.id, tutee_id: userA.id, subject_id: subjectId })
      .select("id")

    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it("REJECTS an over-capacity pairing (max_tutees = 1, second pairing for the same tutor+subject fails)", async () => {
    const subjectId = await createSubject("capacity")
    await offerSubject(userB.id, subjectId, 1)

    const { data: first, error: firstError } = await clientAdmin
      .from("pairings")
      .insert({ tutor_id: userB.id, tutee_id: userA.id, subject_id: subjectId })
      .select("id")
      .single()
    expect(firstError).toBeNull()
    pairingIdsToDelete.push(first!.id)

    // Different tutee (admin instead of userA) so this fails on CAPACITY,
    // not the separate active-uniqueness constraint.
    const { data: second, error: secondError } = await clientAdmin
      .from("pairings")
      .insert({ tutor_id: userB.id, tutee_id: admin.id, subject_id: subjectId })
      .select("id")

    expect(secondError).not.toBeNull()
    expect(second).toBeNull()
  })

  it("REJECTS a second active pairing for the same (tutor, tutee, subject), but a new one SUCCEEDS after the first is ended", async () => {
    const subjectId = await createSubject("reactivate")
    await offerSubject(userA.id, subjectId, 5)

    const { data: first, error: firstError } = await clientAdmin
      .from("pairings")
      .insert({ tutor_id: userA.id, tutee_id: userB.id, subject_id: subjectId })
      .select("id")
      .single()
    expect(firstError).toBeNull()
    pairingIdsToDelete.push(first!.id)

    const { data: duplicate, error: duplicateError } = await clientAdmin
      .from("pairings")
      .insert({ tutor_id: userA.id, tutee_id: userB.id, subject_id: subjectId })
      .select("id")
    expect(duplicateError).not.toBeNull()
    expect(duplicate).toBeNull()

    const { error: endError } = await clientAdmin
      .from("pairings")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", first!.id)
    expect(endError).toBeNull()

    const { data: rePaired, error: rePairedError } = await clientAdmin
      .from("pairings")
      .insert({ tutor_id: userA.id, tutee_id: userB.id, subject_id: subjectId })
      .select("id")
      .single()
    expect(rePairedError).toBeNull()
    expect(rePaired).not.toBeNull()
    pairingIdsToDelete.push(rePaired!.id)
  })

  it("creating a pairing from a request flips it to 'matched'; ending the pairing returns it to 'pending'", async () => {
    const subjectId = await createSubject("request_sync")
    await offerSubject(userA.id, subjectId, 5)

    const { data: request, error: requestError } = await clientAdmin
      .from("tutee_requests")
      .insert({ subject_id: subjectId, student_id: userB.id, source: "self" })
      .select("id, status")
      .single()
    expect(requestError).toBeNull()
    expect(request?.status).toBe("pending")
    requestIdsToDelete.push(request!.id)

    const { data: pairing, error: pairingError } = await clientAdmin
      .from("pairings")
      .insert({
        tutor_id: userA.id,
        tutee_id: userB.id,
        subject_id: subjectId,
        request_id: request!.id,
      })
      .select("id")
      .single()
    expect(pairingError).toBeNull()
    pairingIdsToDelete.push(pairing!.id)

    const { data: afterCreate, error: afterCreateError } = await clientAdmin
      .from("tutee_requests")
      .select("status")
      .eq("id", request!.id)
      .single()
    expect(afterCreateError).toBeNull()
    expect(afterCreate?.status).toBe("matched")

    const { error: endError } = await clientAdmin
      .from("pairings")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", pairing!.id)
    expect(endError).toBeNull()

    const { data: afterEnd, error: afterEndError } = await clientAdmin
      .from("tutee_requests")
      .select("status")
      .eq("id", request!.id)
      .single()
    expect(afterEndError).toBeNull()
    expect(afterEnd?.status).toBe("pending")
  })
})
