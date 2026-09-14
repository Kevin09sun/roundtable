"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { updateMeetingTime } from "@/lib/actions/session"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * Inline meeting_time editor for /pairings/[id]. Only rendered by the
 * caller when editable is true (an active/paused pairing the current user
 * participates in) -- pairings_update / pairings_restrict_participant_update
 * (see supabase/migrations/20260912093000_allow_participant_meeting_time_edit.sql)
 * are the real security boundary either way.
 */
export function MeetingTimeEditor({
  pairingId,
  meetingTime,
  editable,
}: {
  pairingId: string
  meetingTime: string | null
  editable: boolean
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(meetingTime ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSubmitting(true)
    setError(null)
    const result = await updateMeetingTime({ pairingId, meetingTime: value })
    setSubmitting(false)

    if ("error" in result) {
      setError(result.error)
      return
    }
    toast.success("Meeting time updated.")
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">
          {meetingTime ?? "Meeting time not set yet"}
        </span>
        {editable && (
          <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Tuesdays after school in the library"
        maxLength={500}
      />
      {error && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={submitting} onClick={handleSave}>
          {submitting ? "Saving..." : "Save"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={submitting}
          onClick={() => {
            setValue(meetingTime ?? "")
            setEditing(false)
            setError(null)
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
