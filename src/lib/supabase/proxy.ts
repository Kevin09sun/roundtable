import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

/**
 * Refreshes the Supabase auth session on every request and keeps the
 * request/response cookies in sync. Uses the current `@supabase/ssr`
 * cookie API (`getAll`/`setAll`).
 *
 * Also returns the (re-validated) user so `src/proxy.ts` can make route
 * protection decisions (redirecting unauthenticated users, enforcing
 * onboarding, etc.) without a second round-trip to Supabase Auth.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Do not run any code between `createServerClient` and
  // `supabase.auth.getUser()`. A simple mistake could make it very hard to
  // debug issues with users being randomly logged out.

  // IMPORTANT: `getUser()` re-validates the auth token with the Supabase
  // auth server on every call. Do not remove it, and do not swap it for
  // `getSession()`, which only reads the (unverified) local session.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // IMPORTANT: Callers must return the `supabaseResponse` object as is (or a
  // response built from it). If you're creating a new response object, make
  // sure to:
  // 1. Pass the `request` in it
  // 2. Copy over the cookies
  // 3. Change the new response object, not `supabaseResponse`, if you need
  //    to change headers.
  // Failing to do this may cause the browser and server to go out of sync
  // and terminate the user's session prematurely.

  // Return the client too (bound to these same request cookies) so
  // `src/proxy.ts` can run further authorization checks — e.g. reading the
  // caller's own profile row to decide whether onboarding is complete —
  // without constructing a second client or re-validating the session again.
  return { supabase, supabaseResponse, user }
}
