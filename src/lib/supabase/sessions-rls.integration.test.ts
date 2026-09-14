import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Integration tests that exercise Row Level Security AND the triggers
 * touched by Phase 5 -- `sessions` (see
 * supabase/migrations/20260912090000_create_sessions_schema.sql), the
 * participant meeting_time edit + capacity-check fix on `pairings` (see
 * supabase/migrations/20260912093000_allow_participant_meeting_time_edit.sql),
 * and sessions_update's explicit participation requirement on the resulting
 * row (see
 * supabase/migrations/20260914100000_require_participation_on_sessions_update.sql)
 * -- against the REAL hosted Supabase project (not a mock).
 *
 * Same fixture pattern as pairings-rls.integration.test.ts (see that file's
 * header comment for the full rationale): three fixed, pre-seeded
 * throwaway accounts read from env vars, skipping this whole suite cleanly
 * when they're absent rather than failing. A DEDICATED subject per test
 * group, for the same reason as that file: tutor_subjects has one row per
 * (tutor, subject), so two test groups needing a different max_tutees (or a
 * different "does this tutor offer the subject" answer) for the same tutor
 * cannot share a subject.
 *
 * Cleanup: sessions.pairing_id is ON DELETE CASCADE, so deleting a tracked
 * pairing in afterAll also removes every session logged against it --
 * there is no separate session-id tracking array. Deletion order is still
 * pairings, then tutor_subjects, then subjects (subject_id is ON DELETE
 * RESTRICT from tutor_subjects).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.local) to run the sessions RLS integration tests."
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
    "Skipping sessions RLS integration tests: RT_TEST_USER_A_EMAIL/PASSWORD, " +
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

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function tomorrowIsoDate() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

;(hasFixtureEnv ? describe : describe.skip)("sessions RLS + triggers", () => {
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
      .insert({ name: `__rt_test_sessions_${namePrefix}_${Date.now()}_${Math.random()}__` })
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
      // ON DELETE CASCADE from sessions.pairing_id takes any session rows
      // with it.
      await clientAdmin.from("pairings").delete().in("id", pairingIdsToDelete)
    }
    if (subjectIds.length > 0) {
      await clientAdmin.from("tutor_subjects").delete().in("subject_id", subjectIds)
      await clientAdmin.from("subjects").delete().in("id", subjectIds)
    }

    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut(), clientAdmin.auth.signOut()])
  })

  it("does NOT let a non-participant read, insert, update or delete a session on someone else's pairing", async () => {
    const subjectId = await createSubject("non_participant")
    await offerSubject(admin.id, subjectId, 5)
    // admin is the tutor, userB is the tutee -- userA is part of neither.
    const pairingId = await createPairing(admin.id, userB.id, subjectId)

    const { data: session, error: insertError } = await clientAdmin
      .from("sessions")
      .insert({
        pairing_id: pairingId,
        occurred_on: todayIsoDate(),
        minutes: 30,
        status: "completed",
        logged_by: admin.id,
      })
      .select("id")
      .single()
    expect(insertError).toBeNull()

    // READ: RLS filters the row out rather than raising -- assert the
    // denial explicitly (an empty array).
    const { data: readData, error: readError } = await clientA
      .from("sessions")
      .select("id")
      .eq("id", session!.id)
    expect(readError).toBeNull()
    expect(readData).toEqual([])

    // INSERT: userA is not a participant of this pairing.
    const { data: insertData, error: insertDeniedError } = await clientA
      .from("sessions")
      .insert({
        pairing_id: pairingId,
        occurred_on: todayIsoDate(),
        minutes: 15,
        status: "completed",
        logged_by: userA.id,
      })
      .select("id")
    expect(insertDeniedError).not.toBeNull()
    expect(insertData).toBeNull()

    // UPDATE: no error, but zero rows matched.
    const { data: updateData, error: updateError } = await clientA
      .from("sessions")
      .update({ notes: "tampered" })
      .eq("id", session!.id)
      .select("id")
    expect(updateError).toBeNull()
    expect(updateData).toEqual([])

    // DELETE: no error, but zero rows matched.
    const { data: deleteData, error: deleteError } = await clientA
      .from("sessions")
      .delete()
      .eq("id", session!.id)
      .select("id")
    expect(deleteError).toBeNull()
    expect(deleteData).toEqual([])

    // Confirm the row is genuinely untouched.
    const { data: stillThere } = await clientAdmin
      .from("sessions")
      .select("notes")
      .eq("id", session!.id)
      .single()
    expect(stillThere?.notes).toBeNull()
  })

  it("does NOT let a participant set logged_by to another user", async () => {
    const subjectId = await createSubject("logged_by_spoof")
    await offerSubject(userA.id, subjectId, 5)
    const pairingId = await createPairing(userA.id, userB.id, subjectId)

    const { data, error } = await clientA
      .from("sessions")
      .insert({
        pairing_id: pairingId,
        occurred_on: todayIsoDate(),
        minutes: 30,
        status: "completed",
        logged_by: userB.id,
      })
      .select("id")

    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it("does NOT let a non-admin re-point pairing_id to a pairing they don't participate in, but they CAN still edit minutes/notes on their own session; an admin CAN re-point any session", async () => {
    const subjectId = await createSubject("update_repoint")
    await offerSubject(userA.id, subjectId, 5)
    await offerSubject(admin.id, subjectId, 5)
    // userA participates in `pairingId` but not in `otherPairingId`.
    const pairingId = await createPairing(userA.id, userB.id, subjectId)
    const otherPairingId = await createPairing(admin.id, userB.id, subjectId)

    const { data: session, error: insertError } = await clientA
      .from("sessions")
      .insert({
        pairing_id: pairingId,
        occurred_on: todayIsoDate(),
        minutes: 30,
        status: "completed",
        logged_by: userA.id,
      })
      .select("id")
      .single()
    expect(insertError).toBeNull()

    // Re-pointing to a pairing userA doesn't participate in passes USING
    // (logged_by is still userA's own id going in) but fails WITH CHECK on
    // the resulting row -- Postgres raises 42501 for a WITH CHECK failure
    // (unlike USING filtering a row out, which is silent), so this is a
    // real error, not a silent no-op.
    const { data: repointData, error: repointError } = await clientA
      .from("sessions")
      .update({ pairing_id: otherPairingId })
      .eq("id", session!.id)
      .select("id")
    expect(repointError).not.toBeNull()
    expect(repointData).toBeNull()

    // Not just "it errored" -- the STORED pairing_id must be unchanged.
    const { data: afterRepoint } = await clientAdmin
      .from("sessions")
      .select("pairing_id")
      .eq("id", session!.id)
      .single()
    expect(afterRepoint?.pairing_id).toBe(pairingId)

    // Control: the same user, on the same session, can still edit ordinary
    // columns (minutes/notes) that don't touch which pairing it belongs to.
    const { data: edited, error: editError } = await clientA
      .from("sessions")
      .update({ minutes: 45, notes: "updated by participant" })
      .eq("id", session!.id)
      .select("minutes, notes")
      .single()
    expect(editError).toBeNull()
    expect(edited).toMatchObject({ minutes: 45, notes: "updated by participant" })

    // An admin CAN still re-point any session's pairing_id, including to a
    // pairing the original logger doesn't participate in.
    const { data: adminRepoint, error: adminRepointError } = await clientAdmin
      .from("sessions")
      .update({ pairing_id: otherPairingId })
      .eq("id", session!.id)
      .select("pairing_id")
      .single()
    expect(adminRepointError).toBeNull()
    expect(adminRepoint?.pairing_id).toBe(otherPairingId)
  })

  it("does NOT let a participant DELETE a session; an admin can", async () => {
    const subjectId = await createSubject("delete_denied")
    await offerSubject(userA.id, subjectId, 5)
    const pairingId = await createPairing(userA.id, userB.id, subjectId)

    const { data: session, error: insertError } = await clientA
      .from("sessions")
      .insert({
        pairing_id: pairingId,
        occurred_on: todayIsoDate(),
        minutes: 45,
        status: "completed",
        logged_by: userA.id,
      })
      .select("id")
      .single()
    expect(insertError).toBeNull()

    const { data: deniedData, error: deniedError } = await clientA
      .from("sessions")
      .delete()
      .eq("id", session!.id)
      .select("id")
    expect(deniedError).toBeNull()
    expect(deniedData).toEqual([])

    const { data: stillThere } = await clientAdmin
      .from("sessions")
      .select("id")
      .eq("id", session!.id)
    expect(stillThere).toHaveLength(1)

    const { data: adminDeleted, error: adminError } = await clientAdmin
      .from("sessions")
      .delete()
      .eq("id", session!.id)
      .select("id")
    expect(adminError).toBeNull()
    expect(adminDeleted).toHaveLength(1)
  })

  it("lets a participant update meeting_time on their own active pairing, and rejects changing protected columns in the same call", async () => {
    const subjectId = await createSubject("meeting_time_edit")
    await offerSubject(userA.id, subjectId, 5)
    const pairingId = await createPairing(userA.id, userB.id, subjectId)

    // Legitimate solo meeting_time edit succeeds.
    const { data: edited, error: editError } = await clientA
      .from("pairings")
      .update({ meeting_time: "Tuesdays after school" })
      .eq("id", pairingId)
      .select("meeting_time")
      .single()
    expect(editError).toBeNull()
    expect(edited?.meeting_time).toBe("Tuesdays after school")

    // A single call that ALSO tries to change protected columns is
    // rejected outright (pairings_restrict_participant_update RAISES) --
    // including the meeting_time value bundled into that same call, since
    // the whole statement is rolled back.
    const { error: tamperError } = await clientA
      .from("pairings")
      .update({
        meeting_time: "Should NOT be applied",
        status: "ended",
        tutor_id: userB.id,
        tutee_id: userA.id,
        subject_id: subjectId,
        ended_at: new Date().toISOString(),
        ended_reason: "tampered",
      })
      .eq("id", pairingId)
    expect(tamperError).not.toBeNull()

    // Not just "no error" -- assert every protected column, AND
    // meeting_time, is unchanged from before the tamper attempt.
    const { data: after } = await clientAdmin
      .from("pairings")
      .select("meeting_time, status, tutor_id, tutee_id, subject_id, ended_at, ended_reason")
      .eq("id", pairingId)
      .single()
    expect(after).toMatchObject({
      meeting_time: "Tuesdays after school",
      status: "active",
      tutor_id: userA.id,
      tutee_id: userB.id,
      subject_id: subjectId,
      ended_at: null,
      ended_reason: null,
    })
  })

  it("does NOT let a participant edit meeting_time on an ENDED pairing", async () => {
    const subjectId = await createSubject("ended_edit_denied")
    await offerSubject(userA.id, subjectId, 5)
    const pairingId = await createPairing(userA.id, userB.id, subjectId)

    const { error: endError } = await clientAdmin
      .from("pairings")
      .update({ status: "ended", ended_at: new Date().toISOString() })
      .eq("id", pairingId)
    expect(endError).toBeNull()

    const { data, error } = await clientA
      .from("pairings")
      .update({ meeting_time: "Should not be allowed" })
      .eq("id", pairingId)
      .select("id")
    expect(error).toBeNull()
    expect(data).toEqual([])

    const { data: after } = await clientAdmin
      .from("pairings")
      .select("meeting_time")
      .eq("id", pairingId)
      .single()
    expect(after?.meeting_time).toBeNull()
  })

  it("REJECTS a future occurred_on and an out-of-range minutes value", async () => {
    const subjectId = await createSubject("range_checks")
    await offerSubject(userA.id, subjectId, 5)
    const pairingId = await createPairing(userA.id, userB.id, subjectId)

    const { data: futureData, error: futureError } = await clientA
      .from("sessions")
      .insert({
        pairing_id: pairingId,
        occurred_on: tomorrowIsoDate(),
        minutes: 30,
        status: "completed",
        logged_by: userA.id,
      })
      .select("id")
    expect(futureError).not.toBeNull()
    expect(futureData).toBeNull()

    const { data: zeroData, error: zeroError } = await clientA
      .from("sessions")
      .insert({
        pairing_id: pairingId,
        occurred_on: todayIsoDate(),
        minutes: 0,
        status: "completed",
        logged_by: userA.id,
      })
      .select("id")
    expect(zeroError).not.toBeNull()
    expect(zeroData).toBeNull()

    const { data: tooLongData, error: tooLongError } = await clientA
      .from("sessions")
      .insert({
        pairing_id: pairingId,
        occurred_on: todayIsoDate(),
        minutes: 301,
        status: "completed",
        logged_by: userA.id,
      })
      .select("id")
    expect(tooLongError).not.toBeNull()
    expect(tooLongData).toBeNull()
  })

  it("lets a participant edit meeting_time after max_tutees is lowered below the current active count (regression)", async () => {
    const subjectId = await createSubject("lowered_capacity")
    await offerSubject(userA.id, subjectId, 2)

    const pairing1 = await createPairing(userA.id, userB.id, subjectId)
    const pairing2 = await createPairing(userA.id, admin.id, subjectId)

    // Lower max_tutees below the current active count (2 active, now capped
    // at 1) -- this used to make pairings_check_capacity reject EVERY
    // subsequent update of either already-active row, including a
    // meeting_time-only edit that claims no new slot.
    const { error: lowerError } = await clientAdmin
      .from("tutor_subjects")
      .update({ max_tutees: 1 })
      .eq("tutor_id", userA.id)
      .eq("subject_id", subjectId)
    expect(lowerError).toBeNull()

    const { data: edited, error: editError } = await clientA
      .from("pairings")
      .update({ meeting_time: "Thursdays at lunch" })
      .eq("id", pairing1)
      .select("meeting_time")
      .single()
    expect(editError).toBeNull()
    expect(edited?.meeting_time).toBe("Thursdays at lunch")

    // The other already-active row (pairing2) is likewise still editable --
    // both rows kept their slot, neither is claiming a new one.
    const { data: edited2, error: editError2 } = await clientAdmin
      .from("pairings")
      .update({ meeting_time: "Fridays after school" })
      .eq("id", pairing2)
      .select("meeting_time")
      .single()
    expect(editError2).toBeNull()
    expect(edited2?.meeting_time).toBe("Fridays after school")

    // The capacity check still functions for a genuine NEW claim: ending
    // pairing2 and then trying to reactivate it (an UPDATE back to
    // 'active') alongside pairing1 staying active would now exceed the
    // lowered max_tutees of 1.
    const { error: pauseError } = await clientAdmin
      .from("pairings")
      .update({ status: "paused" })
      .eq("id", pairing2)
    expect(pauseError).toBeNull()

    const { data: reactivateData, error: reactivateError } = await clientAdmin
      .from("pairings")
      .update({ status: "active" })
      .eq("id", pairing2)
      .select("id")
    expect(reactivateError).not.toBeNull()
    expect(reactivateData).toBeNull()
  })
})
