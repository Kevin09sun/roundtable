import Link from "next/link"
import { cn } from "cn"

const ADMIN_LINKS = [
  { href: "/admin/requests", label: "Requests" },
  { href: "/admin/pairings", label: "Pairings" },
  { href: "/admin/subjects", label: "Subjects" },
  { href: "/admin/issues", label: "Issues" },
  { href: "/admin/reports", label: "Reports" },
] as const

/**
 * Shared sub-nav for every /admin/* page, replacing the identical inline
 * <nav> block each of those pages used to repeat. Presentation only --
 * `active` is a literal the caller already knows (its own route), so this
 * introduces no new data fetching or routing behavior.
 */
export function AdminNav({
  active,
}: {
  active: (typeof ADMIN_LINKS)[number]["href"]
}) {
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border text-sm">
      {ADMIN_LINKS.map((link) => {
        const isActive = link.href === active
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 font-medium whitespace-nowrap transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            {link.label}
          </Link>
        )
      })}
    </nav>
  )
}
