"use client"

import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { requestTutorHelp } from "@/lib/actions/tutee-request"
import { requestHelpSchema, type RequestHelpInput } from "@/lib/validations/intake"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  pending: "secondary",
  matched: "default",
  closed: "outline",
}

export function RequestHelpForm({ subjects, requests }: Props) {
  const router = useRouter()

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
    <div className="flex w-full max-w-lg flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Request a tutor</CardTitle>
          <CardDescription>Pick a subject you need help with.</CardDescription>
        </CardHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <CardContent className="flex flex-col gap-4">
              <FormField
                control={form.control}
                name="subjectId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select a subject" />
                        </SelectTrigger>
                        <SelectContent>
                          {subjects.map((subject) => (
                            <SelectItem key={subject.id} value={subject.id}>
                              {subject.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
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
                      <Badge variant={STATUS_VARIANT[request.status] ?? "secondary"}>
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
    </div>
  )
}
