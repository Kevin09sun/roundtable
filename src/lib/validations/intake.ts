import { z } from "zod"

// Phase 3 intake: subjects, tutor opt-in, tutee requests, and the public
// teacher referral form. Same pattern as src/lib/validations/auth.ts --
// shared between client-side forms (react-hook-form + zodResolver) and the
// server actions that back them, which re-validate with these same schemas.

export const referSchema = z.object({
  teacherName: z
    .string()
    .trim()
    .min(1, "Teacher name is required.")
    .max(200, "Teacher name is too long."),
  teacherEmail: z.email("Enter a valid email address."),
  studentName: z
    .string()
    .trim()
    .min(1, "Student name is required.")
    .max(200, "Student name is too long."),
  subjectId: z.uuid("Select a subject."),
  note: z
    .string()
    .trim()
    .min(1, "A short reason is required.")
    .max(2000, "Reason is too long."),
  secret: z.string().min(1, "Access code is required."),
})
export type ReferInput = z.infer<typeof referSchema>

export const requestHelpSchema = z.object({
  subjectId: z.uuid("Select a subject."),
})
export type RequestHelpInput = z.infer<typeof requestHelpSchema>

// One entry per subject a tutor offers. `maxTutees` and `availabilityNote`
// are only meaningful when the subject is actually offered, but are always
// present in the shape so the form can keep every active subject's row
// controlled regardless of its checked state.
export const tutorSubjectEntrySchema = z.object({
  subjectId: z.uuid(),
  offering: z.boolean(),
  maxTutees: z
    .number({ error: "Enter a number between 1 and 10." })
    .int("Enter a whole number.")
    .min(1, "Must be at least 1.")
    .max(10, "Must be at most 10."),
  availabilityNote: z
    .string()
    .trim()
    .max(500, "Note is too long.")
    .optional(),
})
export type TutorSubjectEntry = z.infer<typeof tutorSubjectEntrySchema>

export const tutorSubjectsFormSchema = z.object({
  entries: z.array(tutorSubjectEntrySchema),
})
export type TutorSubjectsInput = z.infer<typeof tutorSubjectsFormSchema>

export const createSubjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Subject name is required.")
    .max(200, "Subject name is too long."),
})
export type CreateSubjectInput = z.infer<typeof createSubjectSchema>

export const renameSubjectSchema = z.object({
  id: z.uuid(),
  name: z
    .string()
    .trim()
    .min(1, "Subject name is required.")
    .max(200, "Subject name is too long."),
})
export type RenameSubjectInput = z.infer<typeof renameSubjectSchema>

export const setSubjectActiveSchema = z.object({
  id: z.uuid(),
  isActive: z.boolean(),
})
export type SetSubjectActiveInput = z.infer<typeof setSubjectActiveSchema>
