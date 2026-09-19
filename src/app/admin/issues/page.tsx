import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { AdminNav } from "@/components/admin-nav"
import { PageShell } from "@/components/page-shell"
import { SiteHeader } from "@/components/site-header"
import { AdminIssuesQueue, type IssueQueueRow } from "./admin-issues-queue"

// pairing_id and raised_by are both to-one FKs, so PostgREST embeds a
// single object at runtime -- the untyped Supabase client (no generated
// Database types in this repo, see src/app/request-help/page.tsx for the
// same cast) infers them as arrays instead. Cast at this one boundary
// rather than mistyping IssueQueueRow to match the client's incorrect
// guess. issues has TWO FKs to profiles (raised_by, resolved_by), so the
// raiser embed needs the `!<constraint>` hint to disambiguate -- same
// reasoning as tutor/tutee on pairings (see src/app/admin/pairings/page.tsx).
type RawIssue = {
  id: string
  category: string
  description: string
  status: string
  resolution: string | null
  created_at: string
  pairing_id: string
  pairing: {
    subject: { name: string } | null
    tutor: { full_name: string } | null
    tutee: { full_name: string } | null
  } | null
  raiser: { full_name: string } | null
}

// "Open issues first" ordering: open, then in_progress, then resolved --
// not a plain alphabetical/status-text sort (that would put in_progress
// before open), and not something a single .order() column expresses, so
// it's applied here rather than pushed into the query.
const STATUS_PRIORITY: Record<string, number> = { open: 0, in_progress: 1, resolved: 2 }

export default async function AdminIssuesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  // Defense in depth: re-check admin status server-side rather than
  // relying on the proxy alone (same pattern as every other /admin/* page).
  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) {
    redirect("/dashboard")
  }

  const { data: issuesData } = await supabase
    .from("issues")
    .select(
      `id, category, description, status, resolution, created_at, pairing_id,
       pairing:pairings(
         subject:subjects(name),
         tutor:profiles!pairings_tutor_id_fkey(full_name),
         tutee:profiles!pairings_tutee_id_fkey(full_name)
       ),
       raiser:profiles!issues_raised_by_fkey(full_name)`
    )
    .order("created_at", { ascending: false })

  const rows = (issuesData ?? []) as unknown as RawIssue[]

  const issues: IssueQueueRow[] = rows
    .map((r) => ({
      id: r.id,
      category: r.category,
      description: r.description,
      status: r.status,
      resolution: r.resolution,
      createdAt: r.created_at,
      pairingId: r.pairing_id,
      subjectName: r.pairing?.subject?.name ?? "Unknown subject",
      tutorName: r.pairing?.tutor?.full_name ?? "Unknown",
      tuteeName: r.pairing?.tutee?.full_name ?? "Unknown",
      raisedByName: r.raiser?.full_name ?? "Unknown",
    }))
    .sort((a, b) => {
      const priorityDiff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]
      if (priorityDiff !== 0) return priorityDiff
      return b.createdAt.localeCompare(a.createdAt)
    })

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader userLabel={user.email ?? ""} isAdmin />
      <PageShell>
        <AdminNav active="/admin/issues" />
        <AdminIssuesQueue issues={issues} />
      </PageShell>
    </div>
  )
}
