import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export type IssueRow = {
  id: string
  category: string
  description: string
  status: string
  resolution: string | null
  created_at: string
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  open: "outline",
  in_progress: "secondary",
  resolved: "default",
}

/**
 * The raiser's own filed issues on this pairing -- used on /pairings/[id].
 * issues_select (raised_by = auth.uid() OR is_admin(), see
 * supabase/migrations/20260914110000_create_issues_schema.sql) already
 * restricts the query backing this to the caller's own rows, so `issues`
 * here is never someone else's report.
 */
export function IssueHistory({ issues }: { issues: IssueRow[] }) {
  if (issues.length === 0) {
    return <p className="text-muted-foreground text-sm">You haven&apos;t reported anything yet.</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
          <TableHead>Description</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Resolution</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {issues.map((issue) => (
          <TableRow key={issue.id}>
            <TableCell>{issue.category.replace("_", " ")}</TableCell>
            <TableCell className="text-muted-foreground max-w-xs truncate">
              {issue.description}
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[issue.status] ?? "secondary"}>
                {issue.status.replace("_", " ")}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground max-w-xs truncate">
              {issue.resolution ?? ""}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
