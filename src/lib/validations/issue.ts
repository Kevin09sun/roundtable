import { z } from "zod"

// Phase 6: reporting a problem on a pairing (/pairings/[id]) and the admin
// queue that works it (/admin/issues). Same pattern as
// src/lib/validations/session.ts -- shared between client components and
// the server actions that back them, which re-validate with these same
// schemas. Kept in sync with the `category`/`status` CHECK constraints and
// the description/resolution length caps in
// supabase/migrations/20260914110000_create_issues_schema.sql -- the
// database is the real enforcement, this is just a friendlier error before
// the request is even sent.

export const ISSUE_CATEGORIES = ["scheduling", "no_show", "mismatch", "other"] as const

export const reportIssueSchema = z.object({
  pairingId: z.uuid(),
  category: z.enum(ISSUE_CATEGORIES, { error: "Select a category." }),
  description: z
    .string()
    .trim()
    .min(1, "Description is required.")
    .max(2000, "Description is too long."),
})
export type ReportIssueInput = z.infer<typeof reportIssueSchema>

export const markIssueInProgressSchema = z.object({
  issueId: z.uuid(),
})
export type MarkIssueInProgressInput = z.infer<typeof markIssueInProgressSchema>

export const resolveIssueSchema = z.object({
  issueId: z.uuid(),
  resolution: z
    .string()
    .trim()
    .min(1, "A resolution note is required.")
    .max(2000, "Resolution is too long."),
})
export type ResolveIssueInput = z.infer<typeof resolveIssueSchema>
