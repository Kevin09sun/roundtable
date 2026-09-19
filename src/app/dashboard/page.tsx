import Link from "next/link"
import { redirect } from "next/navigation"
import { Clock, HandHeart, Users } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { LogSessionForm } from "@/components/log-session-form"
import { PageShell } from "@/components/page-shell"
import { SessionHistory, type SessionRow } from "@/components/session-history"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// subject_id/tutor_id/tutee_id are all to-one FKs, so PostgREST embeds a
// single object at runtime -- the untyped Supabase client (no generated
// Database types in this repo, see src/app/request-help/page.tsx for the
// same cast) infers them as arrays instead. sessions is genuinely to-many
// (one pairing has many sessions) so it needs no such cast. Cast at this
// one boundary rather than mistyping this shape to match the client's
// incorrect guess for the to-one fields.
type RawPairing = {
  id: string
  status: string
  meeting_time: string | null
  subject: { name: string } | null
  tutor: { id: string; full_name: string } | null
  tutee: { id: string; full_name: string } | null
  sessions: SessionRow[]
}

// This is the real schedule: "People I tutor" and "My tutors" as distinct
// sections (a person can be both, in different subjects), each pairing
// showing subject, the other person, agreed meeting time, and recent
// sessions, with a quick log-session action. Editing meeting_time and the
// full session history live on /pairings/[id] -- this page is a summary,
// not the place to manage a single pairing in depth. pairings_select
// already restricts the query below to rows where the caller is the tutor
// or the tutee (or an admin), so the `.or()` filter is defense in depth,
// not the security boundary.
export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const [{ data: profile }, { data: pairingsData }, { data: hoursData }] = await Promise.all([
    supabase.from("profiles").select("full_name, is_admin").eq("id", user.id).maybeSingle(),
    supabase
      .from("pairings")
      .select(
        `id, status, meeting_time,
         subject:subjects(name),
         tutor:profiles!pairings_tutor_id_fkey(id, full_name),
         tutee:profiles!pairings_tutee_id_fkey(id, full_name),
         sessions(id, occurred_on, minutes, status, notes)`
      )
      .or(`tutor_id.eq.${user.id},tutee_id.eq.${user.id}`)
      .neq("status", "ended")
      .order("created_at", { ascending: false })
      .order("occurred_on", { ascending: false, referencedTable: "sessions" })
      .limit(3, { referencedTable: "sessions" }),
    // Volunteer-hours total: sum of minutes on 'completed' sessions across
    // every pairing where this user is the tutor. !inner forces the join so
    // .eq("pairing.tutor_id", ...) can filter through it -- sessions_select
    // (participant or admin) already restricts this to sessions the caller
    // may see, so this is a correctness filter (only THIS user's tutoring),
    // not the security boundary.
    supabase
      .from("sessions")
      .select("minutes, pairing:pairings!inner(tutor_id)")
      .eq("status", "completed")
      .eq("pairing.tutor_id", user.id),
  ])

  const pairings = (pairingsData ?? []) as unknown as RawPairing[]
  const tutoring = pairings.filter((p) => p.tutor?.id === user.id)
  const tutored = pairings.filter((p) => p.tutee?.id === user.id)
  const volunteerMinutes = (hoursData ?? []).reduce(
    (sum, row) => sum + (row.minutes ?? 0),
    0
  )
  const volunteerHours = Math.round((volunteerMinutes / 60) * 10) / 10

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader
        userLabel={profile?.full_name ?? user.email ?? ""}
        isAdmin={profile?.is_admin ?? false}
      />
      <PageShell>
        <Card>
          <CardHeader>
            <CardTitle>Welcome, {profile?.full_name ?? user.email}</CardTitle>
            <CardDescription>{user.email}</CardDescription>
            <CardAction>
              <Badge variant={profile?.is_admin ? "default" : "secondary"}>
                {profile?.is_admin ? "Admin" : "Member"}
              </Badge>
            </CardAction>
          </CardHeader>
        </Card>

        {pairings.length === 0 ? (
          <Card>
            <CardHeader className="bg-linear-to-br from-green-50 to-green-100">
              <div className="flex size-10 items-center justify-center rounded-full bg-linear-to-br from-green-100 to-green-200 text-secondary-foreground">
                <HandHeart className="size-5" aria-hidden="true" />
              </div>
              <CardTitle className="mt-2">No pairings yet</CardTitle>
              <CardDescription>
                Your schedule will show up here once you&apos;re matched with someone.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-sm">
              <p className="text-muted-foreground">
                Offer to tutor a subject you know well, or request a tutor for a
                subject you need help with -- an admin matches requests to
                tutors.
              </p>
              <div className="flex flex-wrap gap-3">
                <Button asChild>
                  <Link href="/tutor">Offer to tutor</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/request-help">Request a tutor</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {tutoring.length > 0 && (
              <Card>
                <CardHeader className="bg-linear-to-br from-green-50 to-green-100">
                  <div className="flex items-center gap-2">
                    <Users className="size-4 text-muted-foreground" aria-hidden="true" />
                    <CardTitle>People I tutor</CardTitle>
                  </div>
                  <CardDescription>
                    Everyone you&apos;re currently tutoring, across every subject.
                  </CardDescription>
                  <CardAction>
                    <div className="flex flex-col items-end rounded-lg border border-border bg-secondary px-3 py-1.5 text-secondary-foreground">
                      <span className="flex items-center gap-1 text-xl font-semibold leading-none">
                        <Clock className="size-4" aria-hidden="true" />
                        {volunteerHours}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        volunteer hours logged
                      </span>
                    </div>
                  </CardAction>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {tutoring.map((pairing) => (
                    <PairingCard key={pairing.id} pairing={pairing} counterpart={pairing.tutee} />
                  ))}
                </CardContent>
              </Card>
            )}

            {tutored.length > 0 && (
              <Card>
                <CardHeader className="bg-linear-to-br from-green-50 to-green-100">
                  <CardTitle>My tutors</CardTitle>
                  <CardDescription>
                    Meeting details are arranged directly between tutor and tutee.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  {tutored.map((pairing) => (
                    <PairingCard key={pairing.id} pairing={pairing} counterpart={pairing.tutor} />
                  ))}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </PageShell>
    </div>
  )
}

function PairingCard({
  pairing,
  counterpart,
}: {
  pairing: RawPairing
  counterpart: { id: string; full_name: string } | null
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">
            {pairing.subject?.name ?? "Unknown subject"} --{" "}
            {counterpart?.full_name ?? "Unknown"}
          </div>
          <div className="text-muted-foreground text-sm">
            {pairing.meeting_time ?? "Meeting time not set yet"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={pairing.status === "active" ? "success" : "pending"}>
            {pairing.status}
          </Badge>
          <Link
            href={`/pairings/${pairing.id}`}
            className="text-primary text-sm underline-offset-4 hover:underline"
          >
            View pairing
          </Link>
        </div>
      </div>
      <SessionHistory sessions={pairing.sessions} limit={3} />
      <div>
        <LogSessionForm pairingId={pairing.id} />
      </div>
    </div>
  )
}
