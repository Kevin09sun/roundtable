import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"

/**
 * Exchanges a Supabase auth code (email confirmation, password recovery,
 * etc.) for a session, then redirects into the app. Used as the
 * `emailRedirectTo` / `redirectTo` target for both signup confirmation and
 * password recovery emails — the caller picks the post-exchange
 * destination via `?next=`.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/dashboard"

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Missing or invalid code, or the exchange failed (expired/used link) —
  // send the user to login with a flag it can turn into a real message.
  return NextResponse.redirect(`${origin}/login?error=auth-callback-failed`)
}
