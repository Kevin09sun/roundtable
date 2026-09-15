"use server"

import { createClient } from "@/lib/supabase/server"
import {
  markIssueInProgressSchema,
  reportIssueSchema,
  resolveIssueSchema,
  type MarkIssueInProgressInput,
  type ReportIssueInput,
  type ResolveIssueInput,
} from "@/lib/validations/issue"
import type { ActionResult } from "@/lib/actions/auth"

// Phase 6 issue queue (/pairings/[id], /admin/issues). The real security
// boundary is RLS -- issues_insert (a participant, raised_by = auth.uid()),
// issues_update_admin, issues_delete_admin (both public.is_admin()) -- see
// supabase/migrations/20260914110000_create_issues_schema.sql. These
// actions exist for input validation, explicit raised_by/resolved_by, and
// friendly error shaping; the pages that call them also re-check
// server-side before rendering (see src/app/pairings/[id]/page.tsx and
// src/app/admin/issues/page.tsx).

/**
 * Files a new issue against a pairing. raised_by is set explicitly to the
 * caller's own id rather than trusted from the client -- RLS (issues_insert)
 * would reject a mismatched value anyway, but setting it ourselves means a
 * caller can never even try to file as someone else via a tampered payload.
 */
export async function reportIssue(input: ReportIssueInput): Promise<ActionResult> {
  const parsed = reportIssueSchema.safeParse(input)
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

  const { error } = await supabase.from("issues").insert({
    pairing_id: parsed.data.pairingId,
    category: parsed.data.category,
    description: parsed.data.description,
    raised_by: user.id,
  })

  if (error) {
    return { error: error.message }
  }
  return { success: true }
}

/**
 * Admin-only: moves an issue to 'in_progress'. Under RLS, an UPDATE the
 * caller isn't allowed to perform is not an error -- it matches zero rows
 * and PostgREST reports that as success with an empty result. `.select("id")`
 * and checking the returned rows is what turns "nothing happened" back into
 * a real failure, same pattern as endPairing in src/lib/actions/pairing.ts.
 */
export async function markIssueInProgress(
  input: MarkIssueInProgressInput
): Promise<ActionResult> {
  const parsed = markIssueInProgressSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("issues")
    .update({ status: "in_progress" })
    .eq("id", parsed.data.issueId)
    .select("id")

  if (error) {
    return { error: error.message }
  }
  if (!data || data.length === 0) {
    return { error: "Issue not found, or you do not have permission to update it." }
  }
  return { success: true }
}

/**
 * Admin-only: resolves an issue. resolved_by and resolved_at are set
 * server-side from the acting admin's own session -- never taken from
 * client input -- so a resolution can never be attributed to anyone but
 * whoever actually clicked resolve.
 */
export async function resolveIssue(input: ResolveIssueInput): Promise<ActionResult> {
  const parsed = resolveIssueSchema.safeParse(input)
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

  const { data, error } = await supabase
    .from("issues")
    .update({
      status: "resolved",
      resolution: parsed.data.resolution,
      resolved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.issueId)
    .select("id")

  if (error) {
    return { error: error.message }
  }
  if (!data || data.length === 0) {
    return { error: "Issue not found, or you do not have permission to resolve it." }
  }
  return { success: true }
}
