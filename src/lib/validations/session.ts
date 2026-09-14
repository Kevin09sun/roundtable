import { z } from "zod"

// Phase 5: logging a session against a pairing, and editing a pairing's
// meeting_time. Same pattern as src/lib/validations/pairing.ts -- shared
// between client components and the server actions that back them, which
// re-validate with these same schemas.

// Kept in sync with the `occurred_on <= current_date` and
// `minutes between 1 and 300` CHECK constraints in
// supabase/migrations/20260912090000_create_sessions_schema.sql -- the
// database is the real enforcement, this is just a friendlier error before
// the request is even sent.
const todayIsoDate = () => new Date().toISOString().slice(0, 10)

export const logSessionSchema = z.object({
  pairingId: z.uuid(),
  occurredOn: z
    .string()
    .min(1, "Date is required.")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Enter a valid date.")
    .refine((v) => v <= todayIsoDate(), "Date cannot be in the future."),
  minutes: z
    .number({ error: "Enter a number of minutes." })
    .int("Enter a whole number.")
    .min(1, "Must be at least 1 minute.")
    .max(300, "Must be at most 300 minutes."),
  status: z.enum(["completed", "no_show", "cancelled"], {
    error: "Select a status.",
  }),
  notes: z.string().trim().max(2000, "Notes are too long.").optional(),
})
export type LogSessionInput = z.infer<typeof logSessionSchema>

export const updateMeetingTimeSchema = z.object({
  pairingId: z.uuid(),
  meetingTime: z
    .string()
    .trim()
    .max(500, "Meeting time is too long.")
    .optional(),
})
export type UpdateMeetingTimeInput = z.infer<typeof updateMeetingTimeSchema>
