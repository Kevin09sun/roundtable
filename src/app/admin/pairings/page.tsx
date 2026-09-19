import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { AdminNav } from "@/components/admin-nav"
import { PageShell } from "@/components/page-shell"
import { SiteHeader } from "@/components/site-header"
import { AdminPairingsTable, type PairingRow } from "./admin-pairings-table"

// subject_id/tutor_id/tutee_id are all to-one FKs, so PostgREST embeds a
// single object at runtime -- the untyped Supabase client (no generated
// Database types in this repo, see src/app/request-help/page.tsx for the
// same cast) infers them as arrays instead. Cast at this one boundary
// rather than mistyping PairingRow to match the client's incorrect guess.
type RawPairing = {
  id: string
  meeting_time: string | null
  status: string
  created_at: string
  ended_at: string | null
  ended_reason: string | null
  subject: { name: string } | null
  tutor: { full_name: string } | null
  tutee: { full_name: string } | null
}

export default async function AdminPairingsPage() {
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

  // tutor_id and tutee_id both reference profiles, so the embed needs the
  // `!<constraint>` hint to disambiguate which FK each alias follows.
  // Postgres auto-names these pairings_tutor_id_fkey / pairings_tutee_id_fkey
  // (see the Phase 4 migration -- no explicit constraint names given, same
  // as every other FK in this project).
  const { data: pairingsData } = await supabase
    .from("pairings")
    .select(
      `id, meeting_time, status, created_at, ended_at, ended_reason,
       subject:subjects(name),
       tutor:profiles!pairings_tutor_id_fkey(full_name),
       tutee:profiles!pairings_tutee_id_fkey(full_name)`
    )
    .order("created_at", { ascending: false })

  const rows = (pairingsData ?? []) as unknown as RawPairing[]

  const pairings: PairingRow[] = rows.map((p) => ({
    id: p.id,
    meetingTime: p.meeting_time,
    status: p.status,
    createdAt: p.created_at,
    endedAt: p.ended_at,
    endedReason: p.ended_reason,
    tutorName: p.tutor?.full_name ?? "Unknown",
    tuteeName: p.tutee?.full_name ?? "Unknown",
    subjectName: p.subject?.name ?? "Unknown subject",
  }))

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader userLabel={user.email ?? ""} isAdmin />
      <PageShell>
        <AdminNav active="/admin/pairings" />
        <AdminPairingsTable pairings={pairings} />
      </PageShell>
    </div>
  )
}
