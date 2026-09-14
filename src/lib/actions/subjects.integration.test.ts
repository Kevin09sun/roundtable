import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

// See pairing.integration.test.ts's header for why this is the only mock:
// it replaces the cookie-backed client `subjects.ts` normally gets from
// @/lib/supabase/server with whichever already-signed-in fixture client the
// current test needs to act as. `vi.hoisted` is required because Vitest
// hoists `vi.mock(...)` factories (and this variable, since the factory
// closes over it) above every `import` in this file, including the import
// of subjects.ts below -- that's what makes the mock apply to it.
const mockServerClient = vi.hoisted<{ client: SupabaseClient | null }>(() => ({ client: null }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mockServerClient.client,
}))

import { renameSubject, setSubjectActive } from "@/lib/actions/subjects"

/**
 * Integration tests for the RLS-no-op fix in src/lib/actions/subjects.ts
 * (renameSubject, setSubjectActive): under RLS, an UPDATE the caller isn't
 * allowed to perform is not an error -- it matches zero rows and PostgREST
 * reports that as success with an empty result. Before the fix, both
 * actions treated `error === null` as `{ success: true }`, so a denied
 * write (a non-admin calling either) silently reported success while
 * changing nothing. These tests call the REAL action functions against the
 * REAL hosted Supabase project -- same fixtures and "not a mock" philosophy
 * as src/lib/actions/pairing.integration.test.ts -- and assert the
 * corrected behaviour: a denied write must come back as `{ error: ... }`,
 * not `{ success: true }`, and the row must be genuinely unchanged.
 *
 * Same fixture pattern as the sibling integration suites: three fixed,
 * pre-seeded throwaway accounts read from env vars, skipping this whole
 * suite cleanly when they're absent rather than failing.
 *
 * This suite creates its own throwaway subjects (never touching the three
 * fixture profiles) and cleans them up in afterAll.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.local) to run the subjects actions integration tests."
  )
}

const rawFixtureEnv = {
  userA: {
    email: process.env.RT_TEST_USER_A_EMAIL,
    password: process.env.RT_TEST_USER_A_PASSWORD,
  },
  admin: {
    email: process.env.RT_TEST_ADMIN_EMAIL,
    password: process.env.RT_TEST_ADMIN_PASSWORD,
  },
}

const hasFixtureEnv = Object.values(rawFixtureEnv).every((f) => Boolean(f.email && f.password))

if (!hasFixtureEnv) {
  console.warn(
    "Skipping subjects actions integration tests: RT_TEST_USER_A_EMAIL/PASSWORD and " +
      "RT_TEST_ADMIN_EMAIL/PASSWORD must all be set (see .env.example) to run against the " +
      "live Supabase project."
  )
}

const FIXTURES = rawFixtureEnv as {
  userA: { email: string; password: string }
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

;(hasFixtureEnv ? describe : describe.skip)("subjects actions: RLS-denied write handling", () => {
  const clientA = newClient()
  const clientAdmin = newClient()

  const subjectIdsToDelete: string[] = []

  async function createSubject(namePrefix: string, isActive = true): Promise<string> {
    const { data, error } = await clientAdmin
      .from("subjects")
      .insert({ name: `__rt_test_${namePrefix}_${Date.now()}_${Math.random()}__`, is_active: isActive })
      .select("id")
      .single()
    if (error || !data) {
      throw new Error(`Failed to seed test subject: ${error?.message}`)
    }
    subjectIdsToDelete.push(data.id)
    return data.id
  }

  beforeAll(async () => {
    await Promise.all([signIn(clientA, FIXTURES.userA), signIn(clientAdmin, FIXTURES.admin)])
  })

  afterAll(async () => {
    if (subjectIdsToDelete.length > 0) {
      await clientAdmin.from("subjects").delete().in("id", subjectIdsToDelete)
    }
    await Promise.all([clientA.auth.signOut(), clientAdmin.auth.signOut()])
  })

  it("does NOT report success when a non-admin calls renameSubject, and leaves the row unchanged", async () => {
    const originalName = `__rt_test_rename_original_${Date.now()}__`
    const { data: seeded, error: seedError } = await clientAdmin
      .from("subjects")
      .insert({ name: originalName })
      .select("id")
      .single()
    expect(seedError).toBeNull()
    subjectIdsToDelete.push(seeded!.id)

    mockServerClient.client = clientA
    const result = await renameSubject({ id: seeded!.id, name: "Renamed by non-admin" })

    expect(result).toHaveProperty("error")
    if ("error" in result) {
      expect(result.error.length).toBeGreaterThan(0)
    }

    const { data: afterAttempt, error: readError } = await clientAdmin
      .from("subjects")
      .select("name")
      .eq("id", seeded!.id)
      .single()
    expect(readError).toBeNull()
    expect(afterAttempt?.name).toBe(originalName)
  })

  it("still reports success and actually renames the subject when an admin calls renameSubject", async () => {
    const subjectId = await createSubject("rename_admin")

    mockServerClient.client = clientAdmin
    const result = await renameSubject({ id: subjectId, name: "Renamed by admin" })

    expect(result).toEqual({ success: true })

    const { data: afterRename, error: readError } = await clientAdmin
      .from("subjects")
      .select("name")
      .eq("id", subjectId)
      .single()
    expect(readError).toBeNull()
    expect(afterRename?.name).toBe("Renamed by admin")
  })

  it("does NOT report success when a non-admin calls setSubjectActive, and leaves the row unchanged", async () => {
    const subjectId = await createSubject("active_denied", true)

    mockServerClient.client = clientA
    const result = await setSubjectActive({ id: subjectId, isActive: false })

    expect(result).toHaveProperty("error")
    if ("error" in result) {
      expect(result.error.length).toBeGreaterThan(0)
    }

    const { data: afterAttempt, error: readError } = await clientAdmin
      .from("subjects")
      .select("is_active")
      .eq("id", subjectId)
      .single()
    expect(readError).toBeNull()
    expect(afterAttempt?.is_active).toBe(true)
  })

  it("still reports success and actually flips is_active when an admin calls setSubjectActive", async () => {
    const subjectId = await createSubject("active_admin", true)

    mockServerClient.client = clientAdmin
    const result = await setSubjectActive({ id: subjectId, isActive: false })

    expect(result).toEqual({ success: true })

    const { data: afterFlip, error: readError } = await clientAdmin
      .from("subjects")
      .select("is_active")
      .eq("id", subjectId)
      .single()
    expect(readError).toBeNull()
    expect(afterFlip?.is_active).toBe(false)
  })
})
