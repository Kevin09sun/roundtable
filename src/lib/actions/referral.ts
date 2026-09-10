"use server"

import { timingSafeEqual } from "node:crypto"

import { createClient } from "@/lib/supabase/server"
import { referSchema, type ReferInput } from "@/lib/validations/intake"
import type { ActionResult } from "@/lib/actions/auth"

/**
 * Length-checked before the constant-time compare because
 * `timingSafeEqual` throws on mismatched buffer lengths rather than
 * returning false. Leaking the fact that lengths differ is a far smaller
 * leak than a naive `===`, which also leaks WHERE the first differing
 * character is via early exit.
 */
function secretsMatch(a: string, b: string) {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

/**
 * Public, unauthenticated action backing /refer. Defense in depth, check 1
 * of 2: TEACHER_REFERRAL_SECRET is a server-only env var (no NEXT_PUBLIC_
 * prefix -- never reaches the client bundle) validated here BEFORE the
 * database is touched at all. Check 2 is independent and lives inside
 * Postgres -- see submit_teacher_referral() in
 * supabase/migrations/20260910004250_create_teacher_referral_path.sql --
 * which does NOT trust this check either; it re-validates the same secret
 * against a hash it owns. Neither check is sufficient on its own by design.
 */
export async function submitTeacherReferral(input: ReferInput): Promise<ActionResult> {
  const parsed = referSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }
  const { teacherName, teacherEmail, studentName, subjectId, note, secret } = parsed.data

  const expectedSecret = process.env.TEACHER_REFERRAL_SECRET
  if (!expectedSecret || !secretsMatch(secret, expectedSecret)) {
    return { error: "Invalid access code." }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc("submit_teacher_referral", {
    p_form_secret: secret,
    p_teacher_name: teacherName,
    p_teacher_email: teacherEmail,
    p_student_name: studentName,
    p_subject_id: subjectId,
    p_note: note,
  })

  if (error) {
    // The RPC's own error messages (wrong code, throttled, bad subject,
    // missing field) are already written to be shown to the form as-is --
    // see submit_teacher_referral's RAISE EXCEPTION messages.
    return { error: error.message }
  }

  return { success: true }
}

export type ActiveSubject = { id: string; name: string }

/**
 * Public subject list for the /refer form. Goes through
 * list_active_subjects() (SECURITY DEFINER) rather than
 * `.from("subjects")` because `anon` holds zero table privileges on
 * subjects -- see supabase/migrations/20260910004539_expose_active_subjects_to_anon.sql.
 */
export async function listActiveSubjectsForReferral(): Promise<ActiveSubject[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("list_active_subjects")

  if (error || !data) {
    return []
  }
  return data as ActiveSubject[]
}
