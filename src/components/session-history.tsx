import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type SessionRow = {
  id: string
  occurred_on: string
  minutes: number
  status: string
  notes: string | null
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  completed: "default",
  no_show: "secondary",
  cancelled: "outline",
}

/**
 * Shared session-history table -- used both as a short "recent sessions"
 * preview per pairing card on /dashboard (pass `limit`) and as the full
 * history on /pairings/[id] (omit `limit`). `sessions` is expected
 * pre-sorted newest-first by the caller's query.
 */
export function SessionHistory({
  sessions,
  limit,
}: {
  sessions: SessionRow[]
  limit?: number
}) {
  const rows = limit ? sessions.slice(0, limit) : sessions

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No sessions logged yet.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Minutes</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((session) => (
          <TableRow key={session.id}>
            <TableCell>{session.occurred_on}</TableCell>
            <TableCell>{session.minutes}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[session.status] ?? "secondary"}>
                {session.status.replace("_", " ")}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground max-w-xs truncate">
              {session.notes ?? ""}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
