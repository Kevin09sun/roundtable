"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useFieldArray, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"

import { saveTutorSubjects } from "@/lib/actions/tutor"
import { tutorSubjectsFormSchema, type TutorSubjectsInput } from "@/lib/validations/intake"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type Subject = { id: string; name: string }
type Offering = {
  subject_id: string
  max_tutees: number
  availability_note: string | null
}

type Props = {
  subjects: Subject[]
  offerings: Offering[]
}

export function TutorForm({ subjects, offerings }: Props) {
  const router = useRouter()
  const offeringBySubject = new Map(offerings.map((o) => [o.subject_id, o]))

  // Local UI state only -- never part of the zod schema or submitted
  // payload. Filtering happens at render time (see the null-return inside
  // fields.map below), never by touching `fields`/`entries` themselves.
  const [subjectQuery, setSubjectQuery] = useState("")
  const trimmedQuery = subjectQuery.trim().toLowerCase()

  const form = useForm<TutorSubjectsInput>({
    resolver: zodResolver(tutorSubjectsFormSchema),
    defaultValues: {
      entries: subjects.map((subject) => {
        const existing = offeringBySubject.get(subject.id)
        return {
          subjectId: subject.id,
          offering: Boolean(existing),
          maxTutees: existing?.max_tutees ?? 2,
          availabilityNote: existing?.availability_note ?? "",
        }
      }),
    },
  })

  const { fields } = useFieldArray({ control: form.control, name: "entries" })
  // useWatch (a proper hook, called once at the top level) rather than
  // form.watch() -- form.watch() returns a plain function React Compiler
  // can't safely memoize, and calling it per-field inside the render loop
  // below would rerun that unmemoizable subscription once per field.
  const watchedEntries = useWatch({ control: form.control, name: "entries" })

  const selectedCount = watchedEntries.filter((entry) => entry?.offering).length
  const isMatch = (name: string) =>
    trimmedQuery === "" || name.toLowerCase().includes(trimmedQuery)
  // A row is visible if it matches the filter, OR it's checked -- a
  // checked subject must never appear to vanish just because the filter
  // no longer matches it.
  const anyVisible = subjects.some(
    (subject, index) => watchedEntries[index]?.offering || isMatch(subject.name)
  )

  async function onSubmit(values: TutorSubjectsInput) {
    const result = await saveTutorSubjects(values)

    if ("error" in result) {
      form.setError("root", { message: result.error })
      return
    }

    router.refresh()
  }

  if (subjects.length === 0) {
    return (
      <Card className="w-full max-w-7xl">
        <CardHeader>
          <CardTitle>Offer to tutor</CardTitle>
          <CardDescription>
            No subjects are available yet -- check back once an admin adds
            some.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-7xl">
      <CardHeader>
        <CardTitle>Offer to tutor</CardTitle>
        <CardDescription>
          Pick the subjects you can help with. Editable anytime.
        </CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <CardContent className="flex flex-col gap-6">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="subject-filter">Filter subjects</Label>
              <span className="text-sm text-muted-foreground">
                {selectedCount} selected
              </span>
            </div>
            <Input
              id="subject-filter"
              type="text"
              placeholder="Search courses..."
              value={subjectQuery}
              onChange={(e) => setSubjectQuery(e.target.value)}
            />
          </div>
          {!anyVisible && (
            <p className="text-muted-foreground text-sm">No courses match.</p>
          )}
          {/*
            A CSS grid on the container changes layout only, not array
            order -- fields.map below still walks EVERY index (with its
            existing render-time `return null` for filtered-out rows), so
            entries[index] stays aligned with subjects[index] exactly as
            before. Grid rows size to their tallest cell automatically, so
            a checked course whose "Max tutees" / "Availability note"
            fields expand never overlaps or clips its neighbours.
          */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {fields.map((_field, index) => {
              const subject = subjects[index]
              const offering = watchedEntries[index]?.offering

              // Render-time filtering ONLY -- `fields`/`entries` is never
              // filtered, sliced, or reordered. `fields.map` still walks
              // every index so entries[index] stays aligned with
              // subjects[index] (form.register(`entries.${index}...`)
              // depends on that). A row that doesn't match the current
              // filter, and isn't checked, simply renders nothing.
              // Checked rows always render regardless of the filter, so a
              // tutor never sees their selection appear to vanish.
              if (!offering && !isMatch(subject.name)) {
                return null
              }

              // Keyed and id'd by subject.id, NOT react-hook-form's field.id:
              // field.id is a fresh random value on every render pass, so
              // using it for a DOM id causes a server/client hydration
              // mismatch (the id generated during SSR never matches the one
              // generated during client hydration). subject.id is stable
              // data from the database and identical on both passes.
              return (
                <div
                  key={subject.id}
                  className="flex flex-col gap-3 rounded-lg border p-3"
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`offering-${subject.id}`}
                      checked={offering}
                      onCheckedChange={(checked) =>
                        form.setValue(`entries.${index}.offering`, checked === true)
                      }
                    />
                    <Label htmlFor={`offering-${subject.id}`}>{subject.name}</Label>
                  </div>
                  {offering && (
                    <div className="flex flex-col gap-3 pl-6">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`max-${subject.id}`}>Max tutees</Label>
                        <Input
                          id={`max-${subject.id}`}
                          type="number"
                          min={1}
                          max={10}
                          {...form.register(`entries.${index}.maxTutees`, {
                            valueAsNumber: true,
                          })}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`note-${subject.id}`}>
                          Availability note (optional)
                        </Label>
                        <Textarea
                          id={`note-${subject.id}`}
                          rows={2}
                          {...form.register(`entries.${index}.availabilityNote`)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
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
            {form.formState.isSubmitting ? "Saving..." : "Save"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
