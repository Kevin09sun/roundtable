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
  const { error } = await supabase
    .from("subjects")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.id)
  if (error) {
    return { error: error.message }
  }
  return { success: true }
}

export async function setSubjectActive(input: SetSubjectActiveInput): Promise<ActionResult> {
  const parsed = setSubjectActiveSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("subjects")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.id)
  if (error) {
    return { error: error.message }
  }
  return { success: true }
}
