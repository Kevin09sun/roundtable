import { createServerClient } from "@supabase/ssr"
import { type NextRequest, NextResponse } from "next/server"

/**
 * Refreshes the Supabase auth session on every request and keeps the
 * request/response cookies in sync. Uses the current `@supabase/ssr`
 * cookie API (`getAll`/`setAll`).
 *
 * NOTE: this does not implement route protection. Redirecting
 * unauthenticated users away from protected routes is Phase 2 work — see
 * `src/middleware.ts` for where that logic will be added.
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
  await supabase.auth.getUser()

  // IMPORTANT: You *must* return the `supabaseResponse` object as is. If
  // you're creating a new response object, make sure to:
  // 1. Pass the `request` in it
  // 2. Copy over the cookies
  // 3. Change the `myNewResponse` object, not the `supabaseResponse`
  //    object, if you need to change headers.
  // Failing to do this may cause the browser and server to go out of sync
  // and terminate the user's session prematurely.

  return supabaseResponse
}
