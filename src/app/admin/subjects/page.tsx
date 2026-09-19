import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { AdminNav } from "@/components/admin-nav"
import { PageShell } from "@/components/page-shell"
import { SiteHeader } from "@/components/site-header"
import { AdminSubjectsTable } from "./admin-subjects-table"

export default async function AdminSubjectsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  // Defense in depth: the proxy already redirects a non-admin away from
  // every /admin/* path (see src/proxy.ts), but this page does not rely on
  // that alone -- it re-checks admin status itself before querying or
  // rendering anything admin-only.
  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) {
    redirect("/dashboard")
  }

  // Admins see EVERY subject, active and inactive -- the subjects_select
  // policy's `or public.is_admin()` branch is what allows that; a
  // non-admin running this same query would only get back active rows.
  const { data: subjects } = await supabase
    .from("subjects")
    .select("id, name, is_active, created_at")
    .order("name")

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader userLabel={user.email ?? ""} isAdmin />
      <PageShell>
        <AdminNav active="/admin/subjects" />
        <AdminSubjectsTable subjects={subjects ?? []} />
      </PageShell>
    </div>
  )
}
