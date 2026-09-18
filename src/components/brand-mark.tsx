import Link from "next/link"

/**
 * Small wordmark shown above the card on auth/onboarding pages (login,
 * signup, onboarding, refer, forgot/reset password) -- these pages are
 * reached before or outside the authenticated app shell (SiteHeader), so
 * this gives them a consistent brand anchor instead of dropping straight
 * into a bare card.
 */
export function BrandMark() {
  return (
    <Link
      href="/"
      className="mb-2 flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground"
    >
      <span className="inline-block size-2 rounded-full bg-gold-400" aria-hidden="true" />
      <span className="sm:hidden">Roundtable</span>
      <span className="hidden sm:inline">Roundtable Peer Tutoring Program</span>
    </Link>
  )
}
