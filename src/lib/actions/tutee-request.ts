"use server"

import { createClient } from "@/lib/supabase/server"
import { requestHelpSchema, type RequestHelpInput } from "@/lib/validations/intake"
import type { ActionResult } from "@/lib/actions/auth"

export async function requestTutorHelp(input: RequestHelpInput): Promise<ActionResult> {
  const parsed = requestHelpSchema.safeParse(input)
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

  // RLS (tutee_requests_insert) already restricts a student to inserting
  // the 'self' shape for their own id -- source/student_id here match that
  // shape, they aren't the security boundary themselves.
  const { error } = await supabase.from("tutee_requests").insert({
    subject_id: parsed.data.subjectId,
    student_id: user.id,
    source: "self",
  })

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}
