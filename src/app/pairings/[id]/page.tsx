import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { LogSessionForm } from "@/components/log-session-form"
import { MeetingTimeEditor } from "@/components/meeting-time-editor"
import { SessionHistory, type SessionRow } from "@/components/session-history"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// tutor_id/tutee_id/subject_id are all to-one FKs, so PostgREST embeds a
// single object at runtime -- the untyped Supabase client (no generated
// Database types in this repo, see src/app/request-help/page.tsx for the
// same cast) infers them as arrays instead. Cast at this one boundary
// rather than mistyping this shape to match the client's incorrect guess.
type RawPairing = {
  id: string
  status: string
  meeting_time: string | null
  ended_at: string | null
  ended_reason: string | null
  subject: { name: string } | null
  tutor: { id: string; full_name: string } | null
  tutee: { id: string; full_name: string } | null
}

// Full detail for one pairing: session history, inline meeting-time edit,
// and a pointer to a club VP for anything this app deliberately does not
// automate (ending a pairing for cause, reporting a problem) -- that's
// Phase 6's issues queue, not built here. pairings_select (participant or
// admin) is the real security boundary; the explicit redirect below when
// no row comes back is what stops a participant from opening a pairing
// they are not part of from ever rendering anything, RLS-denied or not.
export default async function PairingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: pairingData } = await supabase
    .from("pairings")
    .select(
      `id, status, meeting_time, ended_at, ended_reason,
       subject:subjects(name),
       tutor:profiles!pairings_tutor_id_fkey(id, full_name),
       tutee:profiles!pairings_tutee_id_fkey(id, full_name)`
    )
    .eq("id", id)
    .maybeSingle()

  if (!pairingData) {
    // Either the id doesn't exist, or RLS filtered it out because the
    // caller isn't the tutor, the tutee, or an admin -- either way there is
    // nothing here for this user to see.
    redirect("/dashboard")
  }

  const pairing = pairingData as unknown as RawPairing

  const { data: sessionsData } = await supabase
    .from("sessions")
    .select("id, occurred_on, minutes, status, notes")
    .eq("pairing_id", id)
    .order("occurred_on", { ascending: false })

  const sessions = (sessionsData ?? []) as SessionRow[]
  const completedMinutes = sessions
    .filter((s) => s.status === "completed")
    .reduce((sum, s) => sum + s.minutes, 0)

  const isParticipant = user.id === pairing.tutor?.id || user.id === pairing.tutee?.id
  const canEditMeetingTime = isParticipant && pairing.status !== "ended"

  return (
    <div className="flex flex-1 justify-center px-6 py-12">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <Link href="/dashboard" className="text-muted-foreground text-sm underline-offset-4 hover:underline">
          Back to dashboard
        </Link>

        <Card>
          <CardHeader>
            <CardTitle>{pairing.subject?.name ?? "Unknown subject"}</CardTitle>
            <CardDescription>
              Tutor: {pairing.tutor?.full_name ?? "Unknown"} -- Tutee:{" "}
              {pairing.tutee?.full_name ?? "Unknown"}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Badge variant={pairing.status === "active" ? "default" : "secondary"}>
                {pairing.status}
              </Badge>
              {pairing.status === "ended" && pairing.ended_reason && (
                <span className="text-muted-foreground text-sm">
                  Ended -- {pairing.ended_reason}
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Meeting time</span>
              <MeetingTimeEditor
                pairingId={pairing.id}
                meetingTime={pairing.meeting_time}
                editable={canEditMeetingTime}
              />
            </div>

            <div className="text-muted-foreground text-sm">
              Volunteer minutes logged on this pairing (completed sessions): {completedMinutes}
            </div>
          </CardContent>
        </Card>

        {isParticipant && pairing.status !== "ended" && (
          <Card>
            <CardHeader>
              <CardTitle>Log a session</CardTitle>
            </CardHeader>
            <CardContent>
              <LogSessionForm pairingId={pairing.id} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Session history</CardTitle>
          </CardHeader>
          <CardContent>
            <SessionHistory sessions={sessions} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Need help with this pairing?</CardTitle>
            <CardDescription>
              This app doesn&apos;t handle problems or ending a pairing for cause on its
              own -- talk to a club VP directly and they&apos;ll take it from there.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}
