"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "cn"

import { signOut } from "@/lib/actions/auth"
import { Button } from "@/components/ui/button"

const MEMBER_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/tutor", label: "Offer to tutor" },
  { href: "/request-help", label: "Request a tutor" },
] as const

/**
 * Shared top-of-app header for authenticated pages: brand mark, primary nav
 * (with the current page highlighted), and sign out. `userLabel` and
 * `isAdmin` are passed in by the caller from data it already fetched (see
 * each page's server component) -- this component makes no queries of its
 * own. isAdmin is only ever passed `true` by /admin/* pages themselves,
 * which have already verified admin status server-side before rendering at
 * all (see the `is_admin` RPC check on each of those pages), so passing it
 * here is just reflecting a fact already established, not a new check.
 */
export function SiteHeader({
  userLabel,
  isAdmin = false,
}: {
  userLabel: string
  isAdmin?: boolean
}) {
  const pathname = usePathname()
  const onAdminSection = pathname?.startsWith("/admin") ?? false

  return (
    <header className="border-b border-green-800 bg-primary text-primary-foreground">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-6 py-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <span
            className="inline-block size-2 rounded-full bg-gold-400"
            aria-hidden="true"
          />
          <span className="sm:hidden">Roundtable</span>
          <span className="hidden sm:inline">Roundtable Peer Tutoring Program</span>
        </Link>

        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {MEMBER_LINKS.map((link) => {
            const isActive = pathname === link.href
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium whitespace-nowrap transition-colors",
                  isActive
                    ? "bg-primary-foreground/15 text-primary-foreground"
                    : "text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
                )}
              >
                {link.label}
              </Link>
            )
          })}
          {isAdmin && (
            <Link
              href="/admin/requests"
              aria-current={onAdminSection ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 font-medium whitespace-nowrap transition-colors",
                onAdminSection
                  ? "bg-gold-400 text-navy"
                  : "text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground"
              )}
            >
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-primary-foreground/80 sm:inline">
            {userLabel}
          </span>
          <form action={signOut}>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
            >
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  )
}
