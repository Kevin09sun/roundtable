"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { createPairing, linkRequestToProfile, searchProfilesByName } from "@/lib/actions/pairing"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export type SuggestedTutor = {
  tutorId: string
  fullName: string
  remainingCapacity: number
  maxTutees: number
  availabilityNote: string | null
}

export type PendingRequestRow = {
  id: string
  subjectId: string
  subjectName: string
  source: "self" | "teacher"
  studentId: string | null
  studentName: string | null
  studentNameRaw: string | null
  referredByName: string | null
  createdAt: string
  note: string | null
  suggestedTutors: SuggestedTutor[]
}

// Deterministic, locale/timezone-independent formatting -- a client
// component like this one is server-rendered on first paint and then
// hydrated in the browser, and anything that reads the runtime's locale or
// timezone (toLocaleString, etc.) can render differently in each place and
// throw a hydration mismatch. toISOString is always UTC, so it's identical
// wherever it runs.
function formatTimestamp(iso: string) {
  return iso.slice(0, 16).replace("T", " ") + " UTC"
}

export function AdminRequestsQueue({ requests }: { requests: PendingRequestRow[] }) {
  if (requests.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Requests queue</CardTitle>
          <CardDescription>No pending requests right now.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {requests.map((request) => (
        <RequestCard key={request.id} request={request} />
      ))}
    </div>
  )
}

function RequestCard({ request }: { request: PendingRequestRow }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pairingTutorId, setPairingTutorId] = useState<string | null>(null)

  async function handlePair(tutorId: string) {
    if (!request.studentId) return
    setError(null)
    setPairingTutorId(tutorId)
    const result = await createPairing({
      requestId: request.id,
      tutorId,
      tuteeId: request.studentId,
      subjectId: request.subjectId,
    })
    setPairingTutorId(null)

    if ("error" in result) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{request.subjectName}</CardTitle>
          <Badge variant={request.source === "teacher" ? "secondary" : "outline"}>
            {request.source === "teacher" ? "Teacher referral" : "Self-requested"}
          </Badge>
        </div>
        <CardDescription>Submitted {formatTimestamp(request.createdAt)}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 text-sm">
          <div>
            <span className="font-medium">Student: </span>
            {request.studentId ? (
              request.studentName
            ) : (
              <>
                <span className="text-muted-foreground">{request.studentNameRaw}</span>{" "}
                <Badge variant="destructive">Needs linking</Badge>
              </>
            )}
          </div>
          {request.source === "teacher" && (
            <div className="text-muted-foreground">Referred by {request.referredByName}</div>
          )}
          {request.note && (
            <div className="text-muted-foreground">
              <span className="font-medium text-foreground">Note: </span>
              {request.note}
            </div>
          )}
        </div>

        {!request.studentId && (
          <LinkStudentControl requestId={request.id} initialQuery={request.studentNameRaw ?? ""} />
        )}

        <div className="flex flex-col gap-2">
          <h4 className="text-sm font-medium">Suggested tutors</h4>
          {!request.studentId ? (
            <p className="text-muted-foreground text-sm">
              Link this request to a student profile above to see suggested tutors.
            </p>
          ) : request.suggestedTutors.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No tutors with open capacity for this subject right now.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {request.suggestedTutors.map((tutor) => (
                <li
                  key={tutor.tutorId}
                  className="flex items-center justify-between gap-3 rounded-md border p-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{tutor.fullName}</div>
                    <div className="text-muted-foreground">
                      {tutor.remainingCapacity} of {tutor.maxTutees} slots open
                      {tutor.availabilityNote ? ` -- ${tutor.availabilityNote}` : ""}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={pairingTutorId === tutor.tutorId}
                    onClick={() => handlePair(tutor.tutorId)}
                  >
                    {pairingTutorId === tutor.tutorId ? "Pairing..." : "Pair"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  )
}

type ProfileMatch = { id: string; full_name: string; grade: number | null }

function LinkStudentControl({
  requestId,
  initialQuery,
}: {
  requestId: string
  initialQuery: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState(initialQuery)
  const [matches, setMatches] = useState<ProfileMatch[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [linkingId, setLinkingId] = useState<string | null>(null)

  async function handleSearch() {
    setError(null)
    setSearching(true)
    const result = await searchProfilesByName({ query })
    setSearching(false)

    if ("error" in result) {
      setError(result.error)
      setMatches(null)
      return
    }
    setMatches(result.profiles)
  }

  async function handleLink(profileId: string) {
    setError(null)
    setLinkingId(profileId)
    const result = await linkRequestToProfile({ requestId, studentId: profileId })
    setLinkingId(null)

    if ("error" in result) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <p className="text-muted-foreground text-sm">
        This referral names a student who isn&apos;t linked to an account yet. Search for their
        profile to link it before pairing.
      </p>
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search students by name"
        />
        <Button type="button" size="sm" variant="outline" disabled={searching} onClick={handleSearch}>
          {searching ? "Searching..." : "Search"}
        </Button>
      </div>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {matches && matches.length === 0 && (
        <p className="text-muted-foreground text-sm">No matching students found.</p>
      )}
      {matches && matches.length > 0 && (
        <ul className="flex flex-col gap-1">
          {matches.map((match) => (
            <li key={match.id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {match.full_name}
                {match.grade != null && ` (grade ${match.grade})`}
              </span>
              <Button
                type="button"
                size="sm"
                disabled={linkingId === match.id}
                onClick={() => handleLink(match.id)}
              >
                {linkingId === match.id ? "Linking..." : "Link"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
