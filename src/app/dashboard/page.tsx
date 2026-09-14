import Link from "next/link"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { signOut } from "@/lib/actions/auth"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

// subject_id/tutor_id/tutee_id are all to-one FKs, so PostgREST embeds a
// single object at runtime -- the untyped Supabase client (no generated
// Database types in this repo, see src/app/request-help/page.tsx for the
// same cast) infers them as arrays instead. Cast at this one boundary
// rather than mistyping this shape to match the client's incorrect guess.
type RawPairing = {
  id: string
  status: string
  meeting_time: string | null
  subject: { name: string } | null
  tutor: { id: string; full_name: string } | null
  tutee: { id: string; full_name: string } | null
}

// Placeholder dashboard — proves the signed-in user can reach a protected
// page and see their own profile, links out to the Phase 3 intake pages,
// and (Phase 4) shows the pairings they're part of. This is a read-only
// summary, not a management UI -- editing meeting_time and session logging
// are Phase 5/6, deliberately not built here. pairings_select already
// restricts the query below to rows where the caller is the tutor or the
// tutee (or an admin), so the `.or()` filter is defense in depth, not the
// security boundary.
export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const [{ data: profile }, { data: pairingsData }] = await Promise.all([
    supabase.from("profiles").select("full_name, is_admin").eq("id", user.id).maybeSingle(),
    supabase
      .from("pairings")
      .select(
        `id, status, meeting_time,
         subject:subjects(name),
         tutor:profiles!pairings_tutor_id_fkey(id, full_name),
         tutee:profiles!pairings_tutee_id_fkey(id, full_name)`
      )
      .or(`tutor_id.eq.${user.id},tutee_id.eq.${user.id}`)
      .neq("status", "ended")
      .order("created_at", { ascending: false }),
  ])

  const pairings = (pairingsData ?? []) as unknown as RawPairing[]

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Welcome, {profile?.full_name ?? user.email}</CardTitle>
            <CardDescription>{user.email}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <Badge variant={profile?.is_admin ? "default" : "secondary"}>
                {profile?.is_admin ? "Admin" : "Member"}
              </Badge>
            </div>
            <nav className="flex flex-col gap-2 text-sm">
              <Link
                href="/tutor"
                className="text-primary underline-offset-4 hover:underline"
              >
                Offer to tutor
              </Link>
              <Link
                href="/request-help"
                className="text-primary underline-offset-4 hover:underline"
              >
                Request a tutor
              </Link>
              {profile?.is_admin && (
                <>
                  <Link
                    href="/admin/requests"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Match requests (admin)
                  </Link>
                  <Link
                    href="/admin/pairings"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    View pairings (admin)
                  </Link>
                  <Link
                    href="/admin/subjects"
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Manage subjects (admin)
                  </Link>
                </>
              )}
            </nav>
            <form action={signOut}>
              <Button type="submit" variant="outline" className="w-full">
                Sign out
              </Button>
            </form>
          </CardContent>
        </Card>

        {pairings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Your pairings</CardTitle>
              <CardDescription>
                Meeting details are arranged directly between tutor and tutee.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {pairings.map((pairing) => {
                const isTutor = pairing.tutor?.id === user.id
                const counterpart = isTutor ? pairing.tutee : pairing.tutor
                return (
                  <div key={pairing.id} className="flex flex-col gap-1 border-b pb-3 text-sm last:border-b-0 last:pb-0">
                    <div className="font-medium">
                      {pairing.subject?.name ?? "Unknown subject"} --{" "}
                      {isTutor ? "you're tutoring" : "tutored by"} {counterpart?.full_name ?? "Unknown"}
                    </div>
                    <div className="text-muted-foreground">
                      {pairing.meeting_time ?? "Meeting time not set yet"}
                    </div>
                    <div>
                      <Badge variant={pairing.status === "active" ? "default" : "secondary"}>
                        {pairing.status}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
