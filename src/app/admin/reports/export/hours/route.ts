import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { toCsv } from "@/lib/csv"

// pairing_id is a to-one FK, so PostgREST embeds a single object at
// runtime -- the untyped Supabase client (no generated Database types in
// this repo, see src/app/request-help/page.tsx for the same cast) infers
// it as an array instead. Cast at this one boundary.
type RawSession = {
  minutes: number
  pairing: { tutor_id: string; tutor: { full_name: string } | null } | null
}

/**
 * CSV export of club-wide volunteer hours per tutor -- same aggregation as
 * /admin/reports (see that page for why the two don't share a helper).
 * Admin-guarded the same way every /admin/* page is. Every field goes
 * through csvField (via toCsv) -- see src/lib/csv.ts -- tutor full_name is
 * attacker-influenced free text (set by the tutor themselves at
 * onboarding) reaching a spreadsheet cell here.
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
    .select("minutes, pairing:pairings(tutor_id, tutor:profiles!pairings_tutor_id_fkey(full_name))")
    .eq("status", "completed")

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = (sessionsData ?? []) as unknown as RawSession[]

  const minutesByTutor = new Map<string, { name: string; minutes: number }>()
  for (const row of rows) {
    const tutorId = row.pairing?.tutor_id
    if (!tutorId) continue
    const existing = minutesByTutor.get(tutorId)
    minutesByTutor.set(tutorId, {
      name: row.pairing?.tutor?.full_name ?? "",
      minutes: (existing?.minutes ?? 0) + row.minutes,
    })
  }

  const hoursRows = [...minutesByTutor.values()]
    .map((v) => ({ ...v, hours: Math.round((v.minutes / 60) * 10) / 10 }))
    .sort((a, b) => b.minutes - a.minutes)

  const csv = toCsv(
    ["Tutor", "Total minutes", "Total hours"],
    hoursRows.map((r) => [r.name, r.minutes, r.hours])
  )

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="volunteer-hours.csv"',
    },
  })
}
