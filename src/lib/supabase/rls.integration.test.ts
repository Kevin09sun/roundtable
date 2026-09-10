import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Integration tests that exercise Row Level Security on `profiles` against
 * the REAL hosted Supabase project (not a mock) — see the policies in
 * supabase/migrations/20260908181632_create_profiles_table.sql.
 *
 * These sign in as three FIXED, pre-seeded throwaway users rather than
 * creating fresh ones via `supabase.auth.signUp()` on every run:
 *
 *   - This project currently requires email confirmation (verified
 *     empirically — signUp() via the anon key returns `session: null`
 *     until the link is clicked), so a plain signUp() here would not
 *     yield a usable session.
 *   - No service_role key is available to this test runtime (only the
 *     anon key lives in .env.local), so there's no admin API to
 *     auto-confirm a freshly-signed-up user either.
 *   - No available Supabase MCP tool exposes the project's Auth "Confirm
 *     email" setting to toggle it off.
 *
 * The three fixtures were seeded directly into auth.users (bcrypt
 * password via pgcrypto, email_confirmed_at set, matching auth.identities
 * row) — the same `on_auth_user_created` trigger that fires for a real
 * signup created their `profiles` rows. They're namespaced with the
 * `rt-test-` prefix and are NOT deleted after this run, specifically so
 * `npm test` keeps passing on later, unattended re-runs; see the phase 2
 * report for the exact seeding SQL and a cleanup statement.
 *
 * IMPORTANT — these fixtures live in the SAME Supabase project as real
 * data (this repo is public; a deployed app necessarily ships its
 * Supabase URL and publishable key in the client bundle, with RLS as the
 * only protection). Their credentials are therefore read from environment
 * variables (RT_TEST_USER_A_EMAIL/PASSWORD, RT_TEST_USER_B_EMAIL/PASSWORD,
 * RT_TEST_ADMIN_EMAIL/PASSWORD — see .env.local, not committed) rather
 * than hardcoded here, and one of the three accounts is an admin. This is
 * a known interim compromise, not the intended end state: the durable fix
 * is a separate, dedicated Supabase project for tests so fixture accounts
 * (admin included) never coexist with real student data. When those env
 * vars are absent (e.g. a fresh clone with no .env.local), this whole
 * suite is skipped rather than failing — see the describe.skip below.
 *
 * Needs network access to the real project, so this lives in its own file
 * rather than alongside the unit tests in src/lib/utils.test.ts.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.local) to run the RLS integration tests."
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

// All six fixture env vars must be present to run this suite at all — see
// the header comment above for why they're not hardcoded. Missing them
// (e.g. a fresh clone with no .env.local) skips the suite cleanly instead
// of failing, so `npm test` stays green with no local setup.
const hasFixtureEnv = Object.values(rawFixtureEnv).every((f) => Boolean(f.email && f.password))

if (!hasFixtureEnv) {
  console.warn(
    "Skipping profiles RLS integration tests: RT_TEST_USER_A_EMAIL/PASSWORD, " +
      "RT_TEST_USER_B_EMAIL/PASSWORD, and RT_TEST_ADMIN_EMAIL/PASSWORD must all be " +
      "set (see .env.example) to run against the live Supabase project."
  )
}

// Only read inside the describe block below, which is skipped entirely
// when hasFixtureEnv is false — the assertion is safe because of that
// guard, not because the underlying env vars are actually guaranteed.
const FIXTURES = rawFixtureEnv as {
  userA: { email: string; password: string }
  userB: { email: string; password: string }
  admin: { email: string; password: string }
}

// Each actor needs its own client instance — a single supabase-js client
// holds exactly one session, and these tests need three live sessions
// (user A, user B, and an admin) at the same time.
function newClient(): SupabaseClient {
  return createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function signIn(
  client: SupabaseClient,
  creds: { email: string; password: string }
) {
  const { data, error } = await client.auth.signInWithPassword(creds)
  if (error || !data.user) {
    throw new Error(
      `Failed to sign in fixture ${creds.email}: ${error?.message ?? "no user returned"}`
    )
  }
  return data.user
}

// Vitest's conditional-suite pattern: run the real describe when the
// fixture env vars are present, otherwise register the suite via
// describe.skip so it shows up as skipped (not silently absent) and
// `npm test` still exits green with no local setup.
;(hasFixtureEnv ? describe : describe.skip)("profiles RLS", () => {
  const clientA = newClient()
  const clientB = newClient()
  const clientAdmin = newClient()

  let userA: { id: string }
  let userB: { id: string }

  beforeAll(async () => {
    ;[userA, userB] = await Promise.all([
      signIn(clientA, FIXTURES.userA),
      signIn(clientB, FIXTURES.userB),
    ])
    await signIn(clientAdmin, FIXTURES.admin)
  })

  afterAll(async () => {
    await Promise.all([
      clientA.auth.signOut(),
      clientB.auth.signOut(),
      clientAdmin.auth.signOut(),
    ])
  })

  it("lets a user read their own profile row", async () => {
    const { data, error } = await clientA
      .from("profiles")
      .select("id, full_name, is_admin")
      .eq("id", userA.id)
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBe(userA.id)
    expect(data?.is_admin).toBe(false)
  })

  it("lets a user update their own profile row", async () => {
    const newName = `RT Test User A ${Date.now()}`

    const { error: updateError } = await clientA
      .from("profiles")
      .update({ full_name: newName })
      .eq("id", userA.id)
    expect(updateError).toBeNull()

    const { data, error } = await clientA
      .from("profiles")
      .select("full_name")
      .eq("id", userA.id)
      .single()

    expect(error).toBeNull()
    expect(data?.full_name).toBe(newName)
  })

  it("does NOT let a user read another user's profile row", async () => {
    const { data, error } = await clientA.from("profiles").select("id").eq("id", userB.id)

    // RLS filters the row out of the result set rather than raising a
    // permission error — assert the denial explicitly (an empty array),
    // not just the absence of an error.
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("does NOT let a user update another user's profile row", async () => {
    const { data: beforeRow } = await clientB
      .from("profiles")
      .select("full_name")
      .eq("id", userB.id)
      .single()

    const { data: updateResult, error: updateError } = await clientA
      .from("profiles")
      .update({ full_name: "Hijacked by user A" })
      .eq("id", userB.id)
      .select()

    // No error — PostgREST reports this as "zero rows matched", not a
    // permission error, because RLS filters the target row out of the
    // update's row set entirely before it ever runs.
    expect(updateError).toBeNull()
    expect(updateResult).toEqual([])

    const { data: afterRow, error: afterError } = await clientB
      .from("profiles")
      .select("full_name")
      .eq("id", userB.id)
      .single()

    expect(afterError).toBeNull()
    expect(afterRow?.full_name).toBe(beforeRow?.full_name)
  })

  it("does NOT let a user set is_admin = true on their own row", async () => {
    // The update itself must not error out — profiles_before_update
    // silently reverts is_admin instead of rejecting the whole update, so
    // a "successful" update here is expected and not itself a pass/fail
    // signal.
    const { error: updateError } = await clientA
      .from("profiles")
      .update({ is_admin: true })
      .eq("id", userA.id)
    expect(updateError).toBeNull()

    // The only trustworthy check is re-reading the row: a silently
    // ignored change is a PASS, an update that actually took effect is a
    // FAIL.
    const { data, error } = await clientA
      .from("profiles")
      .select("is_admin")
      .eq("id", userA.id)
      .single()

    expect(error).toBeNull()
    expect(data?.is_admin).toBe(false)
  })

  it("lets an admin read another user's profile row", async () => {
    const { data, error } = await clientAdmin
      .from("profiles")
      .select("id, full_name")
      .eq("id", userB.id)
      .single()

    expect(error).toBeNull()
    expect(data?.id).toBe(userB.id)
  })

  it("lets an admin update another user's profile row", async () => {
    const newGrade = 7

    const { error: updateError } = await clientAdmin
      .from("profiles")
      .update({ grade: newGrade })
      .eq("id", userB.id)
    expect(updateError).toBeNull()

    const { data, error } = await clientB
      .from("profiles")
      .select("grade")
      .eq("id", userB.id)
      .single()

    expect(error).toBeNull()
    expect(data?.grade).toBe(newGrade)
  })
})
