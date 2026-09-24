"use server"

import { after } from "next/server"

import { sendEmail } from "@/lib/email/send"
import { pairingEmail } from "@/lib/email/templates"
import { getOrigin } from "@/lib/request-origin"
import { createClient } from "@/lib/supabase/server"
import {
  createPairingSchema,
  endPairingSchema,
  linkRequestSchema,
  searchProfilesSchema,
  type CreatePairingInput,
  type EndPairingInput,
  type LinkRequestInput,
  type SearchProfilesInput,
} from "@/lib/validations/pairing"
import type { ActionResult } from "@/lib/actions/auth"

// Phase 4 matching (/admin/requests, /admin/pairings). The real security
// boundary is RLS -- pairings_insert_admin / _update_admin / _delete_admin
// and tutee_requests_update_admin, all `public.is_admin()` -- same pattern
// as src/lib/actions/subjects.ts. These actions exist for input validation
// and friendly error shaping; the pages that call them also re-check admin
// status server-side before rendering (see src/app/admin/requests/page.tsx).

export type ProfileMatch = { id: string; full_name: string; grade: number | null }

/**
 * Search profiles by (trimmed, case-insensitive substring) name, for
 * linking a teacher referral (student_id = null) to a real profile. Goes
 * through the ordinary `.from("profiles")` query rather than an RPC --
 * profiles_select already lets an admin read every row (public.is_admin()
 * branch), so no SECURITY DEFINER carve-out is needed here.
 */
export async function searchProfilesByName(
  input: SearchProfilesInput
): Promise<{ profiles: ProfileMatch[] } | { error: string }> {
  const parsed = searchProfilesSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  // Escape PostgREST/LIKE wildcards in the search text so a name typed with
  // a literal % or _ doesn't get treated as a pattern.
  const escaped = parsed.data.query.replace(/[%_]/g, (match) => `\\${match}`)
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, grade")
    .ilike("full_name", `%${escaped}%`)
    .order("full_name")
    .limit(10)

  if (error) {
    return { error: error.message }
  }
  return { profiles: data ?? [] }
}

/**
 * Links a teacher referral to a real profile: sets student_id, leaves
 * student_name_raw untouched for the audit trail (see the teacher-shape
 * constraint in supabase/migrations/20260910004125_create_intake_schema.sql).
 * A request must be linked before it can be paired -- pairings.tutee_id is
 * NOT NULL, so an unlinked request simply cannot be the target of a
 * pairing; the UI (not a raw DB error) is what should surface that.
 */
export async function linkRequestToProfile(input: LinkRequestInput): Promise<ActionResult> {
  const parsed = linkRequestSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  // Under RLS, an UPDATE the caller isn't allowed to perform is not an
  // error -- it matches zero rows and PostgREST reports that as success
  // with an empty result. `.select("id")` and checking the returned rows
  // is what turns "nothing happened" back into a real failure, instead of
  // silently reporting success for a denied write, a stale id, or an
  // already-linked request.
  const { data, error } = await supabase
    .from("tutee_requests")
    .update({ student_id: parsed.data.studentId })
    .eq("id", parsed.data.requestId)
    .select("id")

  if (error) {
    return { error: error.message }
  }
  if (!data || data.length === 0) {
    return { error: "Request not found, or you do not have permission to link it." }
  }
  return { success: true }
}

/**
 * Postgres error codes that map to a friendlier sentence than the raw
 * constraint-violation text. The trigger-raised errors (capacity, "tutor
 * does not offer that subject" -- see pairings_check_capacity in the Phase
 * 4 migration) are already written as plain sentences and pass through
 * error.message unchanged; only the plain constraint violations below
 * (which the admin queue UI should normally prevent from ever firing, by
 * excluding already-paired tutors from the suggestion list) need translating.
 */
function friendlyPairingError(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "This student is already actively paired with this tutor for this subject."
  }
  if (error.code === "23514") {
    return "A tutor cannot be paired with themselves."
  }
  return error.message
}

// Shape of the row returned by public.pairing_notification_details() --
// see its migration (20260924130000_create_pairing_notification_details.sql)
// for why this has to be a SECURITY DEFINER RPC rather than a plain select.
type PairingNotificationDetails = {
  tutor_name: string
  tutor_email: string
  tutee_name: string
  tutee_email: string
  subject_name: string
}

export async function createPairing(input: CreatePairingInput): Promise<ActionResult> {
  const parsed = createPairingSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }
  const { requestId, tutorId, tuteeId, subjectId } = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("pairings")
    .insert({
      tutor_id: tutorId,
      tutee_id: tuteeId,
      subject_id: subjectId,
      request_id: requestId,
    })
    .select("id")
    .single()

  if (error) {
    return { error: friendlyPairingError(error) }
  }

  // public.pairing_notification_details is the only thing allowed to read
  // auth.users.email for the tutor/tutee (see its migration for why) --
  // called here, with the request-scoped client, because the RPC needs
  // this admin's session cookies. Kept outside `after()` for that reason;
  // the emails themselves (no further DB access needed) are deferred into
  // `after()` below so they never slow down this action's response, and a
  // failure here must never turn a successful pairing into a reported
  // error -- the pairing already exists.
  const origin = await getOrigin()
  const pairingUrl = `${origin}/pairings/${data.id}`

  const { data: rawDetails, error: detailsError } = await supabase
    .rpc("pairing_notification_details", { p_pairing_id: data.id })
    .maybeSingle()
  const details = rawDetails as PairingNotificationDetails | null

  if (detailsError || !details) {
    console.error("Failed to load pairing notification details:", detailsError)
  } else {
    after(async () => {
      await Promise.all([
        sendEmail({
          to: details.tutor_email,
          ...pairingEmail({
            recipientName: details.tutor_name,
            role: "tutor",
            partnerName: details.tutee_name,
            partnerEmail: details.tutee_email,
            subjectName: details.subject_name,
            pairingUrl,
          }),
        }),
        sendEmail({
          to: details.tutee_email,
          ...pairingEmail({
            recipientName: details.tutee_name,
            role: "tutee",
            partnerName: details.tutor_name,
            partnerEmail: details.tutor_email,
            subjectName: details.subject_name,
            pairingUrl,
          }),
        }),
      ])
    })
  }

  return { success: true }
}

/**
 * Ends a pairing. pairings_sync_request_status (AFTER UPDATE trigger) is
 * what returns the originating request to 'pending' when this was its last
 * active pairing -- this action does not need to touch tutee_requests itself.
 */
export async function endPairing(input: EndPairingInput): Promise<ActionResult> {
  const parsed = endPairingSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  // Same reasoning as linkRequestToProfile above: RLS turns a denied UPDATE
  // into an empty-but-error-free result rather than a raised error, so
  // `.select("id")` + checking the returned rows is required to tell "the
  // pairing was actually ended" apart from "a non-admin (or a stale id)
  // silently changed nothing."
  const { data, error } = await supabase
    .from("pairings")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
      ended_reason: parsed.data.reason?.trim() || null,
    })
    .eq("id", parsed.data.pairingId)
    .select("id")

  if (error) {
    return { error: error.message }
  }
  if (!data || data.length === 0) {
    return { error: "Pairing not found, or you do not have permission to end it." }
  }
  return { success: true }
}
