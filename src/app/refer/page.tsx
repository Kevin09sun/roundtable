import { listActiveSubjectsForReferral } from "@/lib/actions/referral"
import { BrandMark } from "@/components/brand-mark"
import { ReferForm } from "./refer-form"

// Public, unauthenticated route -- not behind the proxy's protection (see
// src/proxy.ts). Teachers do not get accounts in v1.
export default async function ReferPage() {
  const subjects = await listActiveSubjectsForReferral()

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12">
      <BrandMark />
      <ReferForm subjects={subjects} />
    </div>
  )
}
