"use server"

import { createClient } from "@/lib/supabase/server"
import { tutorSubjectsFormSchema, type TutorSubjectsInput } from "@/lib/validations/intake"
import type { ActionResult } from "@/lib/actions/auth"

/**
 * Replaces the caller's entire tutor_subjects set with the submitted one:
 * delete everything they currently offer, then insert a row for each
 * subject they checked. Simpler than diffing against the previous state,
 * and RLS (tutor_subjects_delete / _insert, both `tutor_id = auth.uid()`)
 * already guarantees this can only ever touch the caller's own rows.
 */
export async function saveTutorSubjects(input: TutorSubjectsInput): Promise<ActionResult> {
  const parsed = tutorSubjectsFormSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: "You must be signed in to continue." }
  }

  const { error: deleteError } = await supabase
    .from("tutor_subjects")
    .delete()
    .eq("tutor_id", user.id)
  if (deleteError) {
    return { error: deleteError.message }
  }

  const offered = parsed.data.entries.filter((entry) => entry.offering)
  if (offered.length > 0) {
    const rows = offered.map((entry) => ({
      tutor_id: user.id,
      subject_id: entry.subjectId,
      max_tutees: entry.maxTutees,
      availability_note: entry.availabilityNote?.trim() || null,
    }))

    const { error: insertError } = await supabase.from("tutor_subjects").insert(rows)
    if (insertError) {
      return { error: insertError.message }
    }
  }

  return { success: true }
}
