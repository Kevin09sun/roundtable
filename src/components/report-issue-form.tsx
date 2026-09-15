"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import { reportIssue } from "@/lib/actions/issue"
import { ISSUE_CATEGORIES, reportIssueSchema, type ReportIssueInput } from "@/lib/validations/issue"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
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

const CATEGORY_LABELS: Record<(typeof ISSUE_CATEGORIES)[number], string> = {
  scheduling: "Scheduling",
  no_show: "No-show",
  mismatch: "Mismatch",
  other: "Other",
}

/**
 * Report-a-problem form for /pairings/[id] -- replaces the static "talk to
 * a VP" text from Phase 5. Collapsed behind a button by default, same
 * toggle-reveal pattern as LogSessionForm. issues_select
 * (raised_by = auth.uid() OR is_admin(), see
 * supabase/migrations/20260914110000_create_issues_schema.sql) means the
 * raiser sees only their own filed issues afterward, not the other
 * participant's -- that's intentional, see the migration header.
 */
export function ReportIssueForm({ pairingId }: { pairingId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const form = useForm<ReportIssueInput>({
    resolver: zodResolver(reportIssueSchema),
    defaultValues: {
      pairingId,
      category: "scheduling",
      description: "",
    },
  })

  async function onSubmit(values: ReportIssueInput) {
    const result = await reportIssue(values)

    if ("error" in result) {
      form.setError("root", { message: result.error })
      return
    }

    toast.success("Issue filed.")
    form.reset({ pairingId, category: "scheduling", description: "" })
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Report a problem
      </Button>
    )
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-3 rounded-md border p-3"
      >
        <FormField
          control={form.control}
          name="category"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Category</FormLabel>
              <FormControl>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {ISSUE_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {CATEGORY_LABELS[category]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>What happened?</FormLabel>
              <FormControl>
                <Textarea rows={4} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {form.formState.errors.root && (
          <p className="text-destructive text-sm">{form.formState.errors.root.message}</p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Filing..." : "File issue"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={form.formState.isSubmitting}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Form>
  )
}
