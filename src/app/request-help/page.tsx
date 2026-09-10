import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { RequestHelpForm, type RequestRow } from "./request-help-form"

export default async function RequestHelpPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const [{ data: subjects }, { data: requests }] = await Promise.all([
    supabase.from("subjects").select("id, name").eq("is_active", true).order("name"),
    // tutee_requests_select (student_id = auth.uid() OR is_admin()) already
    // restricts this to the caller's own requests.
    supabase
      .from("tutee_requests")
      .select("id, status, created_at, subjects(name)")
      .eq("student_id", user.id)
      .order("created_at", { ascending: false }),
  ])

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <RequestHelpForm
        subjects={subjects ?? []}
        // subject_id -> subjects.id is a to-one FK, so PostgREST embeds a
        // single object at runtime (verified against the live API) -- the
        // untyped Supabase client (no generated Database types in this
        // repo) can't express that and infers an array instead. Cast at
        // this one boundary rather than mistyping RequestRow to match the
        // client's guess (that previously shipped a real bug: every row
        // rendered "Unknown" because .subjects was read as an array).
        requests={(requests ?? []) as unknown as RequestRow[]}
      />
    </div>
  )
}
