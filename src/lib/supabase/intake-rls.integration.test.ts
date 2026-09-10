import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Integration tests that exercise Row Level Security on the Phase 3 intake
 * tables (subjects, tutor_subjects, tutee_requests, tutee_request_notes,
 * app_config) and the submit_teacher_referral RPC, against the REAL hosted
 * Supabase project -- see supabase/migrations/20260910004125_create_intake_schema.sql,
 * 20260910004250_create_teacher_referral_path.sql, and
 * 20260910004539_expose_active_subjects_to_anon.sql.
 *
 * Same fixture pattern as src/lib/supabase/rls.integration.test.ts (see that
 * file's header comment for the full rationale): three fixed, pre-seeded
 * throwaway accounts read from env vars, skipping this whole suite cleanly
 * when they're absent rather than failing. This file additionally needs
 * TEACHER_REFERRAL_SECRET (see .env.local) to exercise the "accepts a
 * correct secret" half of the submit_teacher_referral tests -- also part of
 * the skip gate below, for the same "don't fail on a fresh clone" reason.
 *
 * This suite creates its own throwaway subject + tutee_request rows (never
 * touching the three fixture profiles' data beyond that) and cleans them up
 * in afterAll, in dependency order (notes/requests before the subject,
 * since subject_id is ON DELETE RESTRICT).
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set (see .env.local) to run the intake RLS integration tests."
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
const teacherReferralSecret = process.env.TEACHER_REFERRAL_SECRET

const hasFixtureEnv =
  Object.values(rawFixtureEnv).every((f) => Boolean(f.email && f.password)) &&
  Boolean(teacherReferralSecret)

if (!hasFixtureEnv) {
  console.warn(
    "Skipping intake RLS integration tests: RT_TEST_USER_A_EMAIL/PASSWORD, " +
      "RT_TEST_USER_B_EMAIL/PASSWORD, RT_TEST_ADMIN_EMAIL/PASSWORD, and " +
      "TEACHER_REFERRAL_SECRET must all be set (see .env.example) to run " +
      "against the live Supabase project."
  )
}

const FIXTURES = rawFixtureEnv as {
  userA: { email: string; password: string }
  userB: { email: string; password: string }
  admin: { email: string; password: string }
}
const SECRET = teacherReferralSecret as string

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

;(hasFixtureEnv ? describe : describe.skip)("intake RLS", () => {
  const clientA = newClient()
  const clientB = newClient()
  const clientAdmin = newClient()
  // Deliberately never signed in -- exercises the `anon` role, the same
  // role the public /refer form runs as.
  const clientAnon = newClient()

  let userA: { id: string }
  let userB: { id: string }
  let subjectId: string

  // Rows created mid-test that afterAll must clean up in dependency order.
  const requestIdsToDelete: string[] = []

  beforeAll(async () => {
    ;[userA, userB] = await Promise.all([
      signIn(clientA, FIXTURES.userA),
      signIn(clientB, FIXTURES.userB),
    ])
    await signIn(clientAdmin, FIXTURES.admin)

    const { data: subject, error } = await clientAdmin
      .from("subjects")
      .insert({ name: `__rt_test_intake_subject_${Date.now()}__` })
      .select("id")
      .single()
    if (error || !subject) {
      throw new Error(`Failed to seed test subject: ${error?.message}`)
    }
    subjectId = subject.id
  })

  afterAll(async () => {
    if (requestIdsToDelete.length > 0) {
      await clientAdmin.from("tutee_request_notes").delete().in("request_id", requestIdsToDelete)
      await clientAdmin.from("tutee_requests").delete().in("id", requestIdsToDelete)
    }
    await clientAdmin.from("tutor_subjects").delete().eq("subject_id", subjectId)
    if (subjectId) {
      await clientAdmin.from("subjects").delete().eq("id", subjectId)
    }

    await Promise.all([
      clientA.auth.signOut(),
      clientB.auth.signOut(),
      clientAdmin.auth.signOut(),
    ])
  })

  it("does NOT let a student read another student's tutee_requests row", async () => {
    const { data: request, error: insertError } = await clientAdmin
      .from("tutee_requests")
      .insert({ subject_id: subjectId, student_id: userB.id, source: "self" })
      .select("id")
      .single()
    expect(insertError).toBeNull()
    requestIdsToDelete.push(request!.id)

    const { data, error } = await clientA
      .from("tutee_requests")
      .select("id")
      .eq("id", request!.id)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("does NOT let a student read ANY row in tutee_request_notes, including a note on their own request", async () => {
    const { data: request, error: insertError } = await clientAdmin
      .from("tutee_requests")
      .insert({ subject_id: subjectId, student_id: userA.id, source: "self" })
      .select("id")
      .single()
    expect(insertError).toBeNull()
    requestIdsToDelete.push(request!.id)

    const { error: noteError } = await clientAdmin
      .from("tutee_request_notes")
      .insert({ request_id: request!.id, note: "rt-test note: struggling with the material" })
    expect(noteError).toBeNull()

    // The request belongs to userA -- confirm that alone doesn't grant
    // access to the note about it.
    const { data, error } = await clientA
      .from("tutee_request_notes")
      .select("note")
      .eq("request_id", request!.id)

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("does NOT let a student insert a tutor_subjects row with a different user's tutor_id", async () => {
    const { error } = await clientA
      .from("tutor_subjects")
      .insert({ tutor_id: userB.id, subject_id: subjectId, max_tutees: 2 })

    expect(error).not.toBeNull()

    const { data } = await clientAdmin
      .from("tutor_subjects")
      .select("tutor_id")
      .eq("tutor_id", userB.id)
      .eq("subject_id", subjectId)
    expect(data).toEqual([])
  })

  it("does NOT let a student insert a teacher-source tutee_requests row directly", async () => {
    const { error } = await clientA.from("tutee_requests").insert({
      subject_id: subjectId,
      source: "teacher",
      referred_by_name: "Some Teacher",
      referred_by_email: "teacher@example.com",
      student_name_raw: "Some Student",
    })

    expect(error).not.toBeNull()
  })

  it("does NOT let a non-admin insert/update/delete subjects", async () => {
    const { error: insertError } = await clientA
      .from("subjects")
      .insert({ name: `__rt_test_should_not_exist_${Date.now()}__` })
    expect(insertError).not.toBeNull()

    const { data: updateResult, error: updateError } = await clientA
      .from("subjects")
      .update({ name: "Hijacked name" })
      .eq("id", subjectId)
      .select()
    expect(updateError).toBeNull()
    expect(updateResult).toEqual([])

    const { data: deleteResult, error: deleteError } = await clientA
      .from("subjects")
      .delete()
      .eq("id", subjectId)
      .select()
    expect(deleteError).toBeNull()
    expect(deleteResult).toEqual([])

    // Confirm the subject is untouched.
    const { data: stillThere } = await clientAdmin
      .from("subjects")
      .select("id")
      .eq("id", subjectId)
      .single()
    expect(stillThere?.id).toBe(subjectId)
  })

  it("does NOT let a non-admin read app_config", async () => {
    const { data, error } = await clientA.from("app_config").select("id")

    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it("submit_teacher_referral REJECTS a wrong secret", async () => {
    const { error } = await clientAnon.rpc("submit_teacher_referral", {
      p_form_secret: "definitely-the-wrong-secret",
      p_teacher_name: "RT Test Teacher",
      p_teacher_email: "rt-test-teacher@example.com",
      p_student_name: "RT Test Student",
      p_subject_id: subjectId,
      p_note: "rt-test: should never be inserted",
    })

    expect(error).not.toBeNull()
  })

  it("submit_teacher_referral ACCEPTS a correct secret and creates both the request and the note", async () => {
    const teacherEmail = `rt-test-referrer-${Date.now()}@example.com`

    const { data: requestId, error } = await clientAnon.rpc("submit_teacher_referral", {
      p_form_secret: SECRET,
      p_teacher_name: "RT Test Teacher",
      p_teacher_email: teacherEmail,
      p_student_name: "RT Test Referred Student",
      p_subject_id: subjectId,
      p_note: "rt-test: needs help with the subject",
    })

    expect(error).toBeNull()
    expect(requestId).toBeTruthy()
    requestIdsToDelete.push(requestId as string)

    const { data: request, error: requestError } = await clientAdmin
      .from("tutee_requests")
      .select("source, subject_id, referred_by_email, status")
      .eq("id", requestId as string)
      .single()
    expect(requestError).toBeNull()
    expect(request?.source).toBe("teacher")
    expect(request?.subject_id).toBe(subjectId)
    expect(request?.referred_by_email).toBe(teacherEmail)
    expect(request?.status).toBe("pending")

    const { data: note, error: noteError } = await clientAdmin
      .from("tutee_request_notes")
      .select("note")
      .eq("request_id", requestId as string)
      .single()
    expect(noteError).toBeNull()
    expect(note?.note).toBe("rt-test: needs help with the subject")
  })

  it("lets anon list active subjects via list_active_subjects (the /refer subject picker)", async () => {
    const { data, error } = await clientAnon.rpc("list_active_subjects")

    expect(error).toBeNull()
    expect((data as { id: string; name: string }[] | null)?.some((s) => s.id === subjectId)).toBe(
      true
    )
  })

  it("lets an admin read the notes", async () => {
    const { data: request, error: insertError } = await clientAdmin
      .from("tutee_requests")
      .insert({ subject_id: subjectId, student_id: userA.id, source: "self" })
      .select("id")
      .single()
    expect(insertError).toBeNull()
    requestIdsToDelete.push(request!.id)

    const { error: noteError } = await clientAdmin
      .from("tutee_request_notes")
      .insert({ request_id: request!.id, note: "rt-test note visible to admins" })
    expect(noteError).toBeNull()

    const { data, error } = await clientAdmin
      .from("tutee_request_notes")
      .select("note")
      .eq("request_id", request!.id)
      .single()

    expect(error).toBeNull()
    expect(data?.note).toBe("rt-test note visible to admins")
  })
})
