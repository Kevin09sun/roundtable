"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

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

/**
 * The site origin, derived from the incoming request headers rather than a
 * hardcoded env var, so email redirect links are correct in every
 * environment (localhost, preview, production) without extra config.
 */
async function getOrigin() {
  const requestHeaders = await headers()
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http"
  return `${protocol}://${host}`
}

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

  if (!data.session) {
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
