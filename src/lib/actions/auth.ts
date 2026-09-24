"use server"

import { after } from "next/server"
import { redirect } from "next/navigation"

import { sendEmail } from "@/lib/email/send"
import { welcomeEmail } from "@/lib/email/templates"
import { getOrigin } from "@/lib/request-origin"
import { createClient } from "@/lib/supabase/server"
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
  type SignupInput,
} from "@/lib/validations/auth"

// Server actions never throw a validation/auth error back to the client —
// they return a result the caller can render as a real message. Only
// signOut (which has nothing to say) uses redirect().
export type ActionResult =
  | { error: string }
  | { success: true; needsEmailConfirmation?: boolean }

export async function signUp(input: SignupInput): Promise<ActionResult> {
  const parsed = signupSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }
  const { fullName, email, password } = parsed.data

  const supabase = await createClient()
  const origin = await getOrigin()

  // `full_name` rides along in user metadata so the on-signup trigger
  // (public.handle_new_user) can populate profiles.full_name immediately —
  // the client never inserts into profiles directly.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
    },
  })

  if (error) {
    return { error: error.message }
  }

  const needsEmailConfirmation = !data.session

  // Supabase's signature for "this email is already registered": it
  // returns a fake user object (no error) but with an empty identities
  // array instead of failing outright, so as not to let signup leak
  // which emails already have accounts. Sending a welcome email here
  // would be a lie -- there is no new account -- so skip it.
  const isNewAccount = data.user?.identities?.length !== 0
  if (isNewAccount) {
    // Fire-and-forget: never let the welcome email slow down (or fail) the
    // signup response. `after()` schedules it once the response has been
    // sent.
    after(async () => {
      await sendEmail({
        to: email,
        ...welcomeEmail({ fullName, appUrl: origin, needsEmailConfirmation }),
      })
    })
  }

  if (needsEmailConfirmation) {
    // Email confirmation is required before Supabase issues a session —
    // there is nothing to redirect into yet.
    return { success: true, needsEmailConfirmation: true }
  }

  return { success: true }
}

export async function signIn(input: LoginInput): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }
  const { email, password } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Surface Supabase's real reason (e.g. "Invalid login credentials",
    // "Email not confirmed") instead of a generic failure.
    return { error: error.message }
  }

  return { success: true }
}

export async function requestPasswordReset(
  input: ForgotPasswordInput
): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }
  const { email } = parsed.data

  const supabase = await createClient()
  const origin = await getOrigin()

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  })

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}

export async function resetPassword(
  input: ResetPasswordInput
): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }
  const { password } = parsed.data

  const supabase = await createClient()

  // Setting a new password requires the recovery session that
  // /auth/callback established by exchanging the code from the reset
  // email. No session here means the link was missing, already used, or
  // expired.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      error: "Your reset link has expired or is invalid. Request a new one.",
    }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    return { error: error.message }
  }

  return { success: true }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
