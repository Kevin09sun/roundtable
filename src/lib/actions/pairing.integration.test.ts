import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// See the file header for why this is the only mock: it replaces the
// cookie-backed client `pairing.ts` normally gets from
// @/lib/supabase/server with whichever already-signed-in fixture client the
// current test needs to act as. `vi.hoisted` is required because Vitest
// hoists `vi.mock(...)` factories (and this variable, since the factory
// closes over it) above every `import` in this file, including the import
// of pairing.ts below -- that's what makes the mock apply to it.
const mockServerClient = vi.hoisted<{ client: SupabaseClient | null }>(() => ({ client: null }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockServerClient.client,
}))

import { endPairing, linkRequestToProfile } from "@/lib/actions/pairing"

/**
 * Integration tests for the RLS-no-op fix in src/lib/actions/pairing.ts
 * (endPairing, linkRequestToProfile): under RLS, an UPDATE the caller isn't
 * allowed to perform is not an error -- it matches zero rows and PostgREST
 * reports that as success with an empty result. Before the fix, both
 * actions treated `error === null` as `{ success: true }`, so a denied
 * write (a non-admin calling endPairing, for example) silently reported
 * success while changing nothing. These tests call the REAL action
 * functions against the REAL hosted Supabase project -- same fixtures and
 * "not a mock" philosophy as src/lib/supabase/*.integration.test.ts -- and
 * assert the corrected behaviour: a denied write must come back as
 * `{ error: ... }`, not `{ success: true }`.
 *
 * The ONE thing mocked here is `@/lib/supabase/server`'s `createClient`,
 * and only its cookie plumbing: `pairing.ts` calls
 * `await createClient()` from that module, which reads the request's
 * cookies via `next/headers` -- there is no HTTP request here, so calling
 * it directly throws outside a Next.js request scope. The mock swaps in an
 * already-signed-in supabase-js client (via the same
 * signInWithPassword(...) fixtures the sibling RLS suites use) instead of
 * one built from cookies. Everything downstream of that -- the action's own
 * logic, the network calls, RLS -- is real; nothing about Supabase or RLS
 * itself is mocked or faked.
 *
 * Same fixture pattern as src/lib/supabase/rls.integration.test.ts (see
 * that file's header for the full rationale): three fixed, pre-seeded
 * throwaway accounts read from env vars, skipping this whole suite cleanly
 * when they're absent rather than failing.
 *
 * This suite creates its own throwaway subject, tutor_subjects, and
 * pairings rows (never touching the three fixture profiles themselves) and
 * cleans them up in afterAll, in dependency order (pairings, then
 * tutor_subjects, then subjects) -- same pattern as
 * pairings-rls.integration.test.ts.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.local) to run the pairing actions integration tests."
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
    "Skipping pairing actions integration tests: RT_TEST_USER_A_EMAIL/PASSWORD, " +
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

;(hasFixtureEnv ? describe : describe.skip)("pairing actions: RLS-denied write handling", () => {
  const clientA = newClient()
  const clientB = newClient()
  const clientAdmin = newClient()

  let userA: { id: string }
  let userB: { id: string }

  const subjectIds: string[] = []
  const pairingIdsToDelete: string[] = []

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

  async function offerSubject(tutorId: string, subjectId: string) {
    const { error } = await clientAdmin
      .from("tutor_subjects")
      .insert({ tutor_id: tutorId, subject_id: subjectId, max_tutees: 5 })
    if (error) {
      throw new Error(`Failed to seed tutor_subjects row: ${error.message}`)
    }
  }

  async function createPairing(tutorId: string, tuteeId: string, subjectId: string) {
    const { data, error } = await clientAdmin
      .from("pairings")
      .insert({ tutor_id: tutorId, tutee_id: tuteeId, subject_id: subjectId })
      .select("id, status")
      .single()
    if (error || !data) {
      throw new Error(`Failed to seed test pairing: ${error?.message}`)
    }
    pairingIdsToDelete.push(data.id)
    return data
  }

  beforeAll(async () => {
    ;[userA, userB] = await Promise.all([
      signIn(clientA, FIXTURES.userA),
      signIn(clientB, FIXTURES.userB),
    ])
    await signIn(clientAdmin, FIXTURES.admin)
  })

  afterAll(async () => {
    if (pairingIdsToDelete.length > 0) {
      await clientAdmin.from("pairings").delete().in("id", pairingIdsToDelete)
    }
    if (subjectIds.length > 0) {
      await clientAdmin.from("tutor_subjects").delete().in("subject_id", subjectIds)
      await clientAdmin.from("subjects").delete().in("id", subjectIds)
    }

    await Promise.all([clientA.auth.signOut(), clientB.auth.signOut(), clientAdmin.auth.signOut()])
  })

  it("does NOT report success when a non-admin participant calls endPairing on their own pairing", async () => {
    const subjectId = await createSubject("end_denied")
    await offerSubject(userA.id, subjectId)
    const pairing = await createPairing(userA.id, userB.id, subjectId)

    // userB is a real participant (the tutee) but, per pairings_update_admin,
    // is NOT an admin -- endPairing's UPDATE should be denied by RLS and
    // match zero rows, and the fixed action must surface that as a failure.
    mockServerClient.client = clientB
    const result = await endPairing({ pairingId: pairing.id, reason: "trying to end it myself" })

    expect(result).toHaveProperty("error")
    if ("error" in result) {
      expect(result.error.length).toBeGreaterThan(0)
    }

    // The write must have genuinely not happened, not just been reported
    // as failed -- re-read the row as admin to confirm.
    const { data: afterAttempt, error: readError } = await clientAdmin
      .from("pairings")
      .select("status")
      .eq("id", pairing.id)
      .single()
    expect(readError).toBeNull()
    expect(afterAttempt?.status).toBe("active")
  })

  it("still reports success and actually ends the pairing when an admin calls endPairing", async () => {
    const subjectId = await createSubject("end_admin")
    await offerSubject(userA.id, subjectId)
    const pairing = await createPairing(userA.id, userB.id, subjectId)

    mockServerClient.client = clientAdmin
    const result = await endPairing({ pairingId: pairing.id, reason: "admin ended it" })

    expect(result).toEqual({ success: true })

    const { data: afterEnd, error: readError } = await clientAdmin
      .from("pairings")
      .select("status")
      .eq("id", pairing.id)
      .single()
    expect(readError).toBeNull()
    expect(afterEnd?.status).toBe("ended")
  })

  it("does NOT report success when a non-admin calls linkRequestToProfile", async () => {
    const subjectId = await createSubject("link_denied")

    const { data: request, error: requestError } = await clientAdmin
      .from("tutee_requests")
      .insert({ subject_id: subjectId, source: "teacher", referred_by_name: "T", referred_by_email: "t@example.com", student_name_raw: "Some Student" })
      .select("id, student_id")
      .single()
    expect(requestError).toBeNull()

    mockServerClient.client = clientB
    const result = await linkRequestToProfile({ requestId: request!.id, studentId: userB.id })

    expect(result).toHaveProperty("error")

    const { data: afterAttempt, error: readError } = await clientAdmin
      .from("tutee_requests")
      .select("student_id")
      .eq("id", request!.id)
      .single()
    expect(readError).toBeNull()
    expect(afterAttempt?.student_id).toBeNull()

    await clientAdmin.from("tutee_requests").delete().eq("id", request!.id)
  })
})
