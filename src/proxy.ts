import { type NextRequest, NextResponse } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

// Pages that require a signed-in user.
const PROTECTED_PREFIXES = ["/dashboard", "/onboarding", "/admin"]

// Pages a signed-in user shouldn't be able to re-visit.
const AUTH_ONLY_WHEN_SIGNED_OUT = new Set(["/login", "/signup"])

function isProtectedPath(pathname: string) {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export async function proxy(request: NextRequest) {
  const { supabase, supabaseResponse, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  // Unauthenticated: only protected pages get redirected (to /login, with
  // the originally-requested path preserved so we can send them back).
  if (!user) {
    if (isProtectedPath(pathname)) {
      const loginUrl = new URL("/login", request.url)
      loginUrl.searchParams.set("next", pathname)
      return NextResponse.redirect(loginUrl)
    }
    return supabaseResponse
  }

  // Authenticated and trying to view /login or /signup — nothing to do
  // there, send them into the app instead.
  if (AUTH_ONLY_WHEN_SIGNED_OUT.has(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  // Authenticated and on a protected page: make sure onboarding (full name
  // + grade) is complete before letting them any further into the app, and
  // conversely don't let a fully-onboarded user linger on /onboarding.
  if (isProtectedPath(pathname)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, grade")
      .eq("id", user.id)
      .maybeSingle()

    const needsOnboarding =
      !profile?.full_name || profile.full_name.trim().length === 0 || profile.grade == null

    if (needsOnboarding && pathname !== "/onboarding") {
      return NextResponse.redirect(new URL("/onboarding", request.url))
    }
    if (!needsOnboarding && pathname === "/onboarding") {
      return NextResponse.redirect(new URL("/dashboard", request.url))
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
