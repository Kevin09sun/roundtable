"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { endPairing } from "@/lib/actions/pairing"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type PairingRow = {
  id: string
  meetingTime: string | null
  status: string
  createdAt: string
  endedAt: string | null
  endedReason: string | null
  tutorName: string
  tuteeName: string
  subjectName: string
}

const STATUS_VARIANT: Record<string, "success" | "pending" | "muted"> = {
  active: "success",
  paused: "pending",
  ended: "muted",
}

const FILTERS = ["all", "active", "paused", "ended"] as const
type Filter = (typeof FILTERS)[number]

// Deterministic, locale/timezone-independent formatting -- see the same
// comment in admin-requests-queue.tsx for why toLocaleString would risk a
// hydration mismatch here.
function formatTimestamp(iso: string) {
  return iso.slice(0, 16).replace("T", " ") + " UTC"
}

export function AdminPairingsTable({ pairings }: { pairings: PairingRow[] }) {
  const [filter, setFilter] = useState<Filter>("all")

  const filtered = filter === "all" ? pairings : pairings.filter((p) => p.status === filter)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pairings</CardTitle>
        <CardDescription>Every tutor/tutee pairing, with an action to end one.</CardDescription>
        <div className="flex gap-2 pt-2">
          {FILTERS.map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {filtered.length === 0 ? (
          <p className="text-muted-foreground text-sm">No pairings match this filter.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tutor</TableHead>
                <TableHead>Tutee</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Meeting time</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((pairing) => (
                <PairingTableRow key={pairing.id} pairing={pairing} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function PairingTableRow({ pairing }: { pairing: PairingRow }) {
  const router = useRouter()
  const [ending, setEnding] = useState(false)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirmEnd() {
    setSubmitting(true)
    setError(null)
    const result = await endPairing({ pairingId: pairing.id, reason: reason || undefined })
    setSubmitting(false)

    if ("error" in result) {
      setError(result.error)
      return
    }
    setEnding(false)
    router.refresh()
  }

  return (
    <TableRow>
      <TableCell>{pairing.tutorName}</TableCell>
      <TableCell>{pairing.tuteeName}</TableCell>
      <TableCell>{pairing.subjectName}</TableCell>
      <TableCell className="text-muted-foreground">{pairing.meetingTime ?? "Not set"}</TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <Badge variant={STATUS_VARIANT[pairing.status] ?? "muted"}>{pairing.status}</Badge>
          {pairing.status === "ended" && pairing.endedAt && (
            <span className="text-muted-foreground text-xs">
              Ended {formatTimestamp(pairing.endedAt)}
              {pairing.endedReason ? ` -- ${pairing.endedReason}` : ""}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        {pairing.status === "ended" ? null : ending ? (
          <div className="flex flex-col items-end gap-2">
            <Input
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-48"
            />
            {error && <p className="text-destructive text-xs">{error}</p>}
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={submitting} onClick={handleConfirmEnd}>
                {submitting ? "Ending..." : "Confirm"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={submitting}
                onClick={() => {
                  setEnding(false)
                  setError(null)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={() => setEnding(true)}>
            End
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}
