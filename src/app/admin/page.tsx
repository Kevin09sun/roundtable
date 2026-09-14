import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

// /admin has no content of its own -- just an admin-gated landing spot that
// forwards to the requests queue, the day-to-day admin task (Phase 4).
// Re-checks admin status itself rather than relying on the proxy alone (see
// the comment on /admin/subjects for why).
export default async function AdminIndexPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) {
    redirect("/dashboard")
  }

  redirect("/admin/requests")
}
