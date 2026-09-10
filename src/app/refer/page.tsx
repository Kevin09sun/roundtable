import { listActiveSubjectsForReferral } from "@/lib/actions/referral"
import { ReferForm } from "./refer-form"

// Public, unauthenticated route -- not behind the proxy's protection (see
// src/proxy.ts). Teachers do not get accounts in v1.
export default async function ReferPage() {
  const subjects = await listActiveSubjectsForReferral()

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <ReferForm subjects={subjects} />
    </div>
  )
}
