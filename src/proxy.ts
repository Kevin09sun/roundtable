import { type NextRequest, NextResponse } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

// Pages that require a signed-in user. Note /refer is deliberately NOT
// here -- it's the public, unauthenticated teacher-referral form and must
// stay reachable without a session.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/admin",
  "/tutor",
  "/request-help",
]

// Prefixes that additionally require is_admin. This is the FIRST of two
// checks -- necessary but not sufficient. It stops a non-admin's page load
// from ever reaching the admin UI, but every /admin/* page ALSO re-checks
// is_admin server-side itself (see src/app/admin/subjects/page.tsx) rather
// than trusting the proxy alone, because a proxy check is easy to get
// subtly wrong (a matcher typo, a new route added outside PROTECTED_PREFIXES)
// and authorization for admin-only data should not depend on it being right.
const ADMIN_ONLY_PREFIXES = ["/admin"]

// Pages a signed-in user shouldn't be able to re-visit.
const AUTH_ONLY_WHEN_SIGNED_OUT = new Set(["/login", "/signup"])

function matchesPrefix(pathname: string, prefixes: string[]) {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  )
}

export async function proxy(request: NextRequest) {
  const { supabase, supabaseResponse, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  // Unauthenticated: only protected pages get redirected (to /login, with
  // the originally-requested path preserved so we can send them back).
  if (!user) {
    if (matchesPrefix(pathname, PROTECTED_PREFIXES)) {
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
  if (matchesPrefix(pathname, PROTECTED_PREFIXES)) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, grade, is_admin")
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

    // Necessary-but-not-sufficient admin gate -- see the ADMIN_ONLY_PREFIXES
    // comment above. profile is null-checked (`?.`) so a missing/unreadable
    // profile row defaults to "not admin", not "admin".
    if (matchesPrefix(pathname, ADMIN_ONLY_PREFIXES) && !profile?.is_admin) {
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
