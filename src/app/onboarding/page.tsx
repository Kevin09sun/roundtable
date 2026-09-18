import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { BrandMark } from "@/components/brand-mark"
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
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12">
      <BrandMark />
      <OnboardingForm
        defaultFullName={profile?.full_name ?? ""}
        defaultGrade={profile?.grade ?? undefined}
      />
    </div>
  )
}
