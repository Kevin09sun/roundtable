"use server"

import { createClient } from "@/lib/supabase/server"
import {
  logSessionSchema,
  updateMeetingTimeSchema,
  type LogSessionInput,
  type UpdateMeetingTimeInput,
} from "@/lib/validations/session"
import type { ActionResult } from "@/lib/actions/auth"

// Phase 5 schedules + session logging (/dashboard, /pairings/[id]). The
// real security boundary is RLS -- sessions_select/_insert/_update/_delete
// and pairings_update (see supabase/migrations/20260912090000_create_sessions_schema.sql
// and 20260912093000_allow_participant_meeting_time_edit.sql) -- same
// pattern as src/lib/actions/pairing.ts. These actions exist for input
// validation, explicit logged_by, and friendly error shaping; the pages
// that call them also re-check the caller is a participant server-side
// before rendering (see src/app/pairings/[id]/page.tsx).

/**
 * Logs a session against a pairing. logged_by is set explicitly to the
 * caller's own id rather than trusted from the client -- RLS
 * (sessions_insert) would reject a mismatched value anyway, but setting it
 * ourselves means a caller can never even try to log a session as someone
 * else via a tampered payload.
 */
export async function logSession(input: LogSessionInput): Promise<ActionResult> {
  const parsed = logSessionSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: "You must be signed in to continue." }
  }

  const { error } = await supabase.from("sessions").insert({
    pairing_id: parsed.data.pairingId,
    occurred_on: parsed.data.occurredOn,
    minutes: parsed.data.minutes,
    status: parsed.data.status,
    notes: parsed.data.notes?.trim() || null,
    logged_by: user.id,
  })

  if (error) {
    return { error: error.message }
  }
  return { success: true }
}

/**
 * Updates a pairing's meeting_time. Under RLS, a write the caller isn't
 * allowed to perform (not a participant, or the pairing has ended) is not
 * an error -- it matches zero rows and PostgREST reports that as success
 * with an empty result. `.select("id")` and checking the returned rows is
 * what turns "nothing happened" back into a real failure, same as
 * endPairing in src/lib/actions/pairing.ts.
 */
export async function updateMeetingTime(input: UpdateMeetingTimeInput): Promise<ActionResult> {
  const parsed = updateMeetingTimeSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("pairings")
    .update({ meeting_time: parsed.data.meetingTime?.trim() || null })
    .eq("id", parsed.data.pairingId)
    .select("id")

  if (error) {
    return { error: error.message }
  }
  if (!data || data.length === 0) {
    return {
      error:
        "This pairing could not be updated -- it may have ended, or you may not be part of it.",
    }
  }
  return { success: true }
}
