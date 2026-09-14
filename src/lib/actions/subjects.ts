"use server"

import { createClient } from "@/lib/supabase/server"
import {
  createSubjectSchema,
  renameSubjectSchema,
  setSubjectActiveSchema,
  type CreateSubjectInput,
  type RenameSubjectInput,
  type SetSubjectActiveInput,
} from "@/lib/validations/intake"
import type { ActionResult } from "@/lib/actions/auth"

// Admin-only subject management (/admin/subjects). The real security
// boundary is RLS (subjects_insert_admin / _update_admin, both
// `public.is_admin()`) -- a non-admin's write is rejected by Postgres
// regardless of what these actions do. They exist for input validation and
// error shaping, and the page itself also re-checks admin status
// server-side before rendering (see src/app/admin/subjects/page.tsx).

export async function createSubject(input: CreateSubjectInput): Promise<ActionResult> {
  const parsed = createSubjectSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("subjects").insert({ name: parsed.data.name })
  if (error) {
    return { error: error.message }
  }
  return { success: true }
}

export async function renameSubject(input: RenameSubjectInput): Promise<ActionResult> {
  const parsed = renameSubjectSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  // Under RLS, an UPDATE the caller isn't allowed to perform is not an
  // error -- it matches zero rows and PostgREST reports that as success
  // with an empty result. `.select("id")` and checking the returned rows
  // is what turns "nothing happened" back into a real failure, instead of
  // silently reporting success for a denied write or a stale id (same
  // pattern as linkRequestToProfile / endPairing in
  // src/lib/actions/pairing.ts).
  const { data, error } = await supabase
    .from("subjects")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
    .select("id")

  if (error) {
    return { error: error.message }
  }
  if (!data || data.length === 0) {
    return { error: "Subject not found, or you do not have permission to rename it." }
  }
  return { success: true }
}

export async function setSubjectActive(input: SetSubjectActiveInput): Promise<ActionResult> {
  const parsed = setSubjectActiveSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  // Same reasoning as renameSubject above.
  const { data, error } = await supabase
    .from("subjects")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.id)
    .select("id")

  if (error) {
    return { error: error.message }
  }
  if (!data || data.length === 0) {
    return { error: "Subject not found, or you do not have permission to update it." }
  }
  return { success: true }
}
