import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { toCsv } from "@/lib/csv"

// pairing_id/logged_by are to-one FKs, so PostgREST embeds a single object
// at runtime -- the untyped Supabase client (no generated Database types
// in this repo, see src/app/request-help/page.tsx for the same cast)
// infers them as arrays instead. Cast at this one boundary.
type RawSession = {
  occurred_on: string
  minutes: number
  status: string
  notes: string | null
  pairing: {
    subject: { name: string } | null
    tutor: { full_name: string } | null
    tutee: { full_name: string } | null
  } | null
  logger: { full_name: string } | null
}

/**
 * CSV export of every session -- admin-guarded the same way every
 * /admin/* page is (re-checks is_admin server-side, does not rely on the
 * proxy alone). sessions_select's admin branch is what lets this query see
 * every row; the security boundary is still RLS, this route is just the
 * shape of the download.
 *
 * Every field goes through csvField (via toCsv) -- see src/lib/csv.ts.
 * Student full_name (set by the student themselves at onboarding) and
 * session notes are both attacker-influenced free text reaching a
 * spreadsheet cell here, so nothing in this row is exempt from escaping.
 */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data: sessionsData, error } = await supabase
    .from("sessions")
    .select(
      `occurred_on, minutes, status, notes,
       pairing:pairings(
         subject:subjects(name),
         tutor:profiles!pairings_tutor_id_fkey(full_name),
         tutee:profiles!pairings_tutee_id_fkey(full_name)
       ),
       logger:profiles!sessions_logged_by_fkey(full_name)`
    )
    .order("occurred_on", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (sessionsData ?? []) as unknown as RawSession[]

  const csv = toCsv(
    ["Date", "Subject", "Tutor", "Tutee", "Minutes", "Status", "Logged by", "Notes"],
    rows.map((r) => [
      r.occurred_on,
      r.pairing?.subject?.name ?? "",
      r.pairing?.tutor?.full_name ?? "",
      r.pairing?.tutee?.full_name ?? "",
      r.minutes,
      r.status,
      r.logger?.full_name ?? "",
      r.notes ?? "",
    ])
  )

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="sessions.csv"',
    },
  })
}
