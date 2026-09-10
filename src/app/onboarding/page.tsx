import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { OnboardingForm } from "./onboarding-form"

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, grade")
    .eq("id", user.id)
    .maybeSingle()

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <OnboardingForm
        defaultFullName={profile?.full_name ?? ""}
        defaultGrade={profile?.grade ?? undefined}
      />
    </div>
  )
}
