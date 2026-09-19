"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { cn } from "cn"

import { requestTutorHelp } from "@/lib/actions/tutee-request"
import { requestHelpSchema, type RequestHelpInput } from "@/lib/validations/intake"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type Subject = { id: string; name: string }
export type RequestRow = {
  id: string
  status: string
  created_at: string
  // subject_id -> subjects.id is a to-one FK, so PostgREST embeds a single
  // object here at runtime (verified against the live API) -- the cast in
  // ./page.tsx is what gets us this type past the untyped Supabase
  // client's (incorrect, array) inference.
  subjects: { name: string } | null
}

type Props = {
  subjects: Subject[]
  requests: RequestRow[]
}

const STATUS_VARIANT: Record<string, "pending" | "success" | "muted"> = {
  pending: "pending",
  matched: "success",
  closed: "muted",
}

export function RequestHelpForm({ subjects, requests }: Props) {
  const router = useRouter()

  // Local UI state only -- never part of the zod schema or submitted
  // payload. Filtering happens at render time, never by touching the
  // `subjects` list itself. Mirrors src/app/tutor/tutor-form.tsx.
  const [subjectQuery, setSubjectQuery] = useState("")
  const trimmedQuery = subjectQuery.trim().toLowerCase()
  const isMatch = (name: string) =>
    trimmedQuery === "" || name.toLowerCase().includes(trimmedQuery)

  const form = useForm<RequestHelpInput>({
    resolver: zodResolver(requestHelpSchema),
    defaultValues: { subjectId: "" },
  })

  async function onSubmit(values: RequestHelpInput) {
    const result = await requestTutorHelp(values)

    if ("error" in result) {
      form.setError("root", { message: result.error })
      return
    }

    form.reset({ subjectId: "" })
    router.refresh()
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Request a tutor</CardTitle>
          <CardDescription>Pick a subject you need help with.</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col gap-(--card-spacing)"
          >
            <CardContent className="flex flex-col gap-6">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="subject-filter">Filter subjects</Label>
                <Input
                  id="subject-filter"
                  type="text"
                  placeholder="Search courses..."
                  value={subjectQuery}
                  onChange={(e) => setSubjectQuery(e.target.value)}
                />
              </div>
              <FormField
                control={form.control}
                name="subjectId"
                render={({ field }) => {
                  // A subject that's already selected must stay visible
                  // even if the filter no longer matches it -- the choice
                  // must never appear to vanish. Mirrors the same rule in
                  // src/app/tutor/tutor-form.tsx.
                  const anyVisible = subjects.some(
                    (subject) =>
                      subject.id === field.value || isMatch(subject.name)
                  )

                  return (
                    <FormItem>
                      <FormLabel>Subject</FormLabel>
                      {!anyVisible && (
                        <p className="text-muted-foreground text-sm">
                          No courses match.
                        </p>
                      )}
                      <FormControl>
                        <RadioGroup
                          value={field.value}
                          onValueChange={field.onChange}
                          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
                        >
                          {subjects.map((subject) => {
                            const isSelected = subject.id === field.value

                            // Render-time filtering ONLY, same as
                            // tutor-form.tsx: a subject that doesn't match
                            // the current filter, and isn't selected,
                            // simply renders nothing.
                            if (!isSelected && !isMatch(subject.name)) {
                              return null
                            }

                            return (
                              <div
                                key={subject.id}
                                className={cn(
                                  "flex items-center gap-2 rounded-lg border p-3",
                                  isSelected &&
                                    "border-primary bg-primary/5 ring-1 ring-primary"
                                )}
                              >
                                <RadioGroupItem
                                  value={subject.id}
                                  id={`subject-${subject.id}`}
                                />
                                <Label htmlFor={`subject-${subject.id}`}>
                                  {subject.name}
                                </Label>
                              </div>
                            )
                          })}
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />
              {form.formState.errors.root && (
                <p className="text-destructive text-sm">
                  {form.formState.errors.root.message}
                </p>
              )}
            </CardContent>
            <CardFooter>
              <Button
                type="submit"
                className="w-full"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? "Submitting..." : "Submit request"}
              </Button>
            </CardFooter>
          </form>
        </Form>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your requests</CardTitle>
        </CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-muted-foreground text-sm">No requests yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>{request.subjects?.name ?? "Unknown"}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[request.status] ?? "muted"}>
                        {request.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
