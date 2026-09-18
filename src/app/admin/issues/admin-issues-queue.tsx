"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { markIssueInProgress, resolveIssue } from "@/lib/actions/issue"
import { resolveIssueSchema } from "@/lib/validations/issue"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type IssueQueueRow = {
  id: string
  category: string
  description: string
  status: string
  resolution: string | null
  createdAt: string
  pairingId: string
  subjectName: string
  tutorName: string
  tuteeName: string
  raisedByName: string
}

// Same semantic mapping as issue-history.tsx: open awaits action (pending),
// in_progress is a neutral working state (secondary), resolved is done
// (success).
const STATUS_VARIANT: Record<string, "pending" | "secondary" | "success"> = {
  open: "pending",
  in_progress: "secondary",
  resolved: "success",
}

// Deterministic, locale/timezone-independent formatting -- same reasoning
// as formatTimestamp in admin-requests-queue.tsx.
function formatTimestamp(iso: string) {
  return iso.slice(0, 16).replace("T", " ") + " UTC"
}

/**
 * The admin issue queue (/admin/issues). `issues` is expected pre-sorted
 * open-first by the caller's query -- issues_select's admin branch is what
 * lets this page see every report, including ones raised by the OTHER
 * participant of a pairing an admin isn't part of (see the privacy note in
 * supabase/migrations/20260914110000_create_issues_schema.sql -- ordinary
 * participants never get that visibility).
 */
export function AdminIssuesQueue({ issues }: { issues: IssueQueueRow[] }) {
  if (issues.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Issue queue</CardTitle>
          <CardDescription>No issues reported.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {issues.map((issue) => (
        <IssueCard key={issue.id} issue={issue} />
      ))}
    </div>
  )
}

function IssueCard({ issue }: { issue: IssueQueueRow }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolutionText, setResolutionText] = useState("")

  async function handleMarkInProgress() {
    setError(null)
    setPending(true)
    const result = await markIssueInProgress({ issueId: issue.id })
    setPending(false)

    if ("error" in result) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  async function handleResolve() {
    setError(null)
    const parsed = resolveIssueSchema.safeParse({
      issueId: issue.id,
      resolution: resolutionText,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input.")
      return
    }

    setPending(true)
    const result = await resolveIssue(parsed.data)
    setPending(false)

    if ("error" in result) {
      setError(result.error)
      return
    }
    setResolving(false)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{issue.category.replace("_", " ")}</CardTitle>
          <Badge variant={STATUS_VARIANT[issue.status] ?? "muted"}>
            {issue.status.replace("_", " ")}
          </Badge>
        </div>
        <CardDescription>
          {issue.subjectName} -- Tutor: {issue.tutorName} -- Tutee: {issue.tuteeName}
        </CardDescription>
        <CardDescription>
          Raised by {issue.raisedByName} -- {formatTimestamp(issue.createdAt)}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm">{issue.description}</p>

        {issue.status === "resolved" ? (
          <p className="text-muted-foreground text-sm">
            <span className="font-medium text-foreground">Resolution: </span>
            {issue.resolution}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              {issue.status === "open" && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={handleMarkInProgress}
                >
                  Mark in progress
                </Button>
              )}
              {!resolving && (
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() => setResolving(true)}
                >
                  Resolve
                </Button>
              )}
            </div>
            {resolving && (
              <div className="flex flex-col gap-2 rounded-md border p-3">
                <Textarea
                  rows={3}
                  placeholder="Resolution note"
                  value={resolutionText}
                  onChange={(e) => setResolutionText(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button type="button" size="sm" disabled={pending} onClick={handleResolve}>
                    {pending ? "Saving..." : "Save resolution"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setResolving(false)
                      setResolutionText("")
                      setError(null)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  )
}
