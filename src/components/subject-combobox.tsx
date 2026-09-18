"use client"

import * as React from "react"
import { cn } from "cn"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type Subject = { id: string; name: string }

type Props = {
  subjects: Subject[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  id?: string
  "aria-describedby"?: string
  "aria-invalid"?: React.AriaAttributes["aria-invalid"]
}

/**
 * Searchable subject picker. Built as a Popover + plain text input rather
 * than putting an <Input> inside a Radix Select's SelectContent: Radix
 * Select runs its own typeahead on the content and swallows keystrokes, so
 * a nested search box there does not work. This component reimplements
 * only the listbox behavior it needs (arrow-key highlight, Enter to
 * select, Escape to close) on top of Popover instead.
 */
export function SubjectCombobox({
  subjects,
  value,
  onChange,
  placeholder = "Select a subject",
  id,
  "aria-describedby": ariaDescribedby,
  "aria-invalid": ariaInvalid,
}: Props) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const optionRefs = React.useRef<Array<HTMLDivElement | null>>([])

  const listboxId = React.useId()
  const selected = subjects.find((subject) => subject.id === value)

  const filtered = React.useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return subjects
    return subjects.filter((subject) =>
      subject.name.toLowerCase().includes(trimmed)
    )
  }, [subjects, query])

  React.useEffect(() => {
    optionRefs.current[highlightedIndex]?.scrollIntoView({ block: "nearest" })
  }, [highlightedIndex])

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (nextOpen) {
      setQuery("")
      setHighlightedIndex(-1)
    }
  }

  function selectSubject(subjectId: string) {
    onChange(subjectId)
    setOpen(false)
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setHighlightedIndex((i) =>
        filtered.length === 0 ? -1 : (i + 1) % filtered.length
      )
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setHighlightedIndex((i) =>
        filtered.length === 0 ? -1 : (i - 1 + filtered.length) % filtered.length
      )
    } else if (event.key === "Enter") {
      event.preventDefault()
      const option = filtered[highlightedIndex]
      if (option) {
        selectSubject(option.id)
      }
    }
    // Escape is handled by Radix Popover itself: it closes the popover and
    // returns focus to the trigger button.
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          aria-expanded={open}
          aria-describedby={ariaDescribedby}
          className={cn(
            "flex h-8 w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50",
            !selected && "text-muted-foreground"
          )}
        >
          <span className="line-clamp-1">{selected ? selected.name : placeholder}</span>
          <ChevronDownIcon className="pointer-events-none size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <div className="p-2">
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setHighlightedIndex(-1)
            }}
            onKeyDown={handleInputKeyDown}
            placeholder="Search courses..."
            role="combobox"
            aria-controls={listboxId}
            aria-expanded={open}
            aria-autocomplete="list"
            aria-invalid={ariaInvalid}
            aria-activedescendant={
              highlightedIndex !== -1 && filtered[highlightedIndex]
                ? `${listboxId}-opt-${filtered[highlightedIndex].id}`
                : undefined
            }
          />
        </div>
        <div id={listboxId} role="listbox" className="max-h-72 overflow-y-auto p-1 pt-0">
          {filtered.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              No courses match
            </p>
          ) : (
            filtered.map((subject, index) => {
              const isSelected = subject.id === value
              const isHighlighted = index === highlightedIndex
              return (
                <div
                  key={subject.id}
                  id={`${listboxId}-opt-${subject.id}`}
                  ref={(el) => {
                    optionRefs.current[index] = el
                  }}
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectSubject(subject.id)}
                  className={cn(
                    "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm select-none",
                    isHighlighted && "bg-accent text-accent-foreground"
                  )}
                >
                  <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
                    {isSelected && <CheckIcon className="pointer-events-none size-4" />}
                  </span>
                  {subject.name}
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
