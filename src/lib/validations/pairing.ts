import { z } from "zod"

// Phase 4 matching: linking a teacher referral to a real profile, creating
// a pairing, and ending one. Same pattern as src/lib/validations/intake.ts --
// shared between client components and the server actions that back them,
// which re-validate with these same schemas.

export const searchProfilesSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Enter a name to search.")
    .max(200, "Search is too long."),
})
export type SearchProfilesInput = z.infer<typeof searchProfilesSchema>

export const linkRequestSchema = z.object({
  requestId: z.uuid(),
  studentId: z.uuid(),
})
export type LinkRequestInput = z.infer<typeof linkRequestSchema>

// requestId is nullable: an admin may create a pairing with no originating
// request at all (see pairings.request_id in the Phase 4 migration).
export const createPairingSchema = z.object({
  requestId: z.uuid().nullable(),
  tutorId: z.uuid(),
  tuteeId: z.uuid(),
  subjectId: z.uuid(),
})
export type CreatePairingInput = z.infer<typeof createPairingSchema>

export const endPairingSchema = z.object({
  pairingId: z.uuid(),
  reason: z
    .string()
    .trim()
    .max(2000, "Reason is too long.")
    .optional(),
})
export type EndPairingInput = z.infer<typeof endPairingSchema>
