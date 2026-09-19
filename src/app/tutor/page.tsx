import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { PageShell } from "@/components/page-shell"
import { SiteHeader } from "@/components/site-header"
import { TutorForm } from "./tutor-form"

// A separate route rather than folding this into /onboarding: onboarding is
// a one-time, required flow (name + grade) gated by the proxy, while
// tutoring is optional and explicitly "editable later" -- it belongs with
// the other ongoing-settings-style pages (/request-help), reachable anytime
// from /dashboard, not bundled into first-run signup.
export default async function TutorPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const [{ data: subjects }, { data: offerings }] = await Promise.all([
    supabase.from("subjects").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("tutor_subjects")
      .select("subject_id, max_tutees, availability_note")
      .eq("tutor_id", user.id),
  ])

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader userLabel={user.email ?? ""} />
      <PageShell>
        <TutorForm subjects={subjects ?? []} offerings={offerings ?? []} />
      </PageShell>
    </div>
  )
}
