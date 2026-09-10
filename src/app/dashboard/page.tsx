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

// Placeholder dashboard — proves the signed-in user can reach a protected
// page and see their own profile, and links out to the Phase 3 intake
// pages. Pairings and session logging are Phase 4/5.
export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, is_admin")
    .eq("id", user.id)
    .maybeSingle()

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <Card className="w-full max-w-sm">
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
              <Link
                href="/admin/subjects"
                className="text-primary underline-offset-4 hover:underline"
              >
                Manage subjects (admin)
              </Link>
            )}
          </nav>
          <form action={signOut}>
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
