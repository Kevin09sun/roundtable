"use server"

import { createClient } from "@/lib/supabase/server"
import { onboardingSchema, type OnboardingInput } from "@/lib/validations/auth"
import type { ActionResult } from "@/lib/actions/auth"

export async function completeOnboarding(
  input: OnboardingInput
): Promise<ActionResult> {
  const parsed = onboardingSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }
  const { fullName, grade } = parsed.data

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: "You must be signed in to continue." }
  }

  // RLS (profiles_update_own) already restricts this to the caller's own
  // row; the explicit .eq is defense in depth, not the security boundary.
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, grade })
    .eq("id", user.id)

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}
