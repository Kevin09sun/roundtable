import { redirect } from "next/navigation"
import { Download } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { AdminNav } from "@/components/admin-nav"
import { PageShell } from "@/components/page-shell"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

// pairing_id is a to-one FK, so PostgREST embeds a single object at
// runtime -- the untyped Supabase client (no generated Database types in
// this repo, see src/app/request-help/page.tsx for the same cast) infers
// it as an array instead. Cast at this one boundary.
type RawSession = {
  minutes: number
  pairing: { tutor_id: string; tutor: { full_name: string } | null } | null
}

/**
 * Club-wide volunteer hours: sum of `minutes` on 'completed' sessions, per
 * tutor. Same aggregation the CSV export at /admin/reports/export/hours
 * produces -- this page and that route each run their own query rather
 * than sharing a helper across a Server Component and a Route Handler, to
 * keep the two independently readable (same as the rest of this repo's
 * admin pages, which re-run rather than share their own guard/query logic).
 */
export default async function AdminReportsPage() {
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

  const { data: sessionsData } = await supabase
    .from("sessions")
    .select("minutes, pairing:pairings(tutor_id, tutor:profiles!pairings_tutor_id_fkey(full_name))")
    .eq("status", "completed")

  const rows = (sessionsData ?? []) as unknown as RawSession[]

  const minutesByTutor = new Map<string, { name: string; minutes: number }>()
  for (const row of rows) {
    const tutorId = row.pairing?.tutor_id
    if (!tutorId) continue
    const existing = minutesByTutor.get(tutorId)
    const name = row.pairing?.tutor?.full_name ?? "Unknown"
    minutesByTutor.set(tutorId, {
      name,
      minutes: (existing?.minutes ?? 0) + row.minutes,
    })
  }

  const hoursRows = [...minutesByTutor.entries()]
    .map(([tutorId, v]) => ({
      tutorId,
      name: v.name,
      minutes: v.minutes,
      hours: Math.round((v.minutes / 60) * 10) / 10,
    }))
    .sort((a, b) => b.minutes - a.minutes)

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader userLabel={user.email ?? ""} isAdmin />
      <PageShell>
        <AdminNav active="/admin/reports" />

        <Card>
          <CardHeader>
            <CardTitle>Volunteer hours</CardTitle>
            <CardDescription>
              Club-wide, per tutor -- sum of minutes on completed sessions.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <a href="/admin/reports/export/sessions">
                  <Download data-icon="inline-start" />
                  Export sessions CSV
                </a>
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href="/admin/reports/export/hours">
                  <Download data-icon="inline-start" />
                  Export hours CSV
                </a>
              </Button>
            </div>
            {hoursRows.length === 0 ? (
              <p className="text-muted-foreground text-sm">No completed sessions yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tutor</TableHead>
                    <TableHead>Minutes</TableHead>
                    <TableHead>Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hoursRows.map((row) => (
                    <TableRow key={row.tutorId}>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.minutes}</TableCell>
                      <TableCell className="font-medium">{row.hours}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </PageShell>
    </div>
  )
}
