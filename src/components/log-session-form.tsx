"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"

import { logSession } from "@/lib/actions/session"
import { logSessionSchema, type LogSessionInput } from "@/lib/validations/session"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

const STATUS_OPTIONS: { value: LogSessionInput["status"]; label: string }[] = [
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "No-show" },
  { value: "cancelled", label: "Cancelled" },
]

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Quick log-session action, used both inline on /dashboard (one per
 * pairing card) and on /pairings/[id]. Collapsed behind a button by
 * default -- same toggle-reveal pattern as the "End" action in
 * src/app/admin/pairings/admin-pairings-table.tsx -- rather than always
 * showing a full form, since most pairings on a schedule aren't being
 * logged against right this moment.
 */
export function LogSessionForm({ pairingId }: { pairingId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  const form = useForm<LogSessionInput>({
    resolver: zodResolver(logSessionSchema),
    defaultValues: {
      pairingId,
      occurredOn: todayIsoDate(),
      minutes: 30,
      status: "completed",
      notes: "",
    },
  })

  async function onSubmit(values: LogSessionInput) {
    const result = await logSession(values)

    if ("error" in result) {
      form.setError("root", { message: result.error })
      return
    }

    toast.success("Session logged.")
    form.reset({
      pairingId,
      occurredOn: todayIsoDate(),
      minutes: 30,
      status: "completed",
      notes: "",
    })
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Log session
      </Button>
    )
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-3 rounded-md border p-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="occurredOn"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date</FormLabel>
                <FormControl>
                  <Input type="date" max={todayIsoDate()} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="minutes"
            render={({ field: { onChange, ...field } }) => (
              <FormItem>
                <FormLabel>Minutes</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={300}
                    {...field}
                    onChange={(e) => onChange(e.target.valueAsNumber)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Status</FormLabel>
              <FormControl>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a status" />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
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
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes (optional)</FormLabel>
              <FormControl>
                <Textarea rows={2} {...field} />
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
            {form.formState.isSubmitting ? "Saving..." : "Save session"}
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
