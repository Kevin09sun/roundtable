import { cn } from "cn"

// Sticky-note shades pulled straight from the Crescent gold scale
// (src/app/globals.css). Every shade here pairs with navy text at a
// measured 10+:1 contrast ratio -- do not swap in white text on any of
// these, and do not introduce a shade outside this scale.
const TONE_CLASSES = {
  light: "bg-gold-200",
  medium: "bg-gold-300",
  bold: "bg-gold-400",
} as const

export type StatNoteTone = keyof typeof TONE_CLASSES

/**
 * A single sticky-note style stat card: a big value, a short label, and an
 * optional line of extra context. Presentational only -- callers own
 * whatever the value/label/detail actually mean.
 *
 * `rotate` takes a Tailwind rotation utility (e.g. "-rotate-2") rather than
 * a numeric prop so callers give each note in a row a different small
 * angle (1-3deg) and the row reads as hand-stuck notes rather than a
 * perfectly aligned grid. Hovering straightens the note back to
 * `rotate-0`, disabled for reduced-motion users.
 */
export function StatNote({
  value,
  label,
  detail,
  rotate,
  tone = "medium",
  valueClassName,
  className,
}: {
  value: React.ReactNode
  label: string
  detail?: React.ReactNode
  rotate: string
  tone?: StatNoteTone
  valueClassName?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-h-32 flex-col justify-between gap-3 rounded-md p-4 text-navy shadow-md transition-transform duration-200 ease-out hover:z-10 hover:rotate-0 motion-reduce:transition-none",
        TONE_CLASSES[tone],
        rotate,
        className
      )}
    >
      <span
        className={cn(
          "line-clamp-2 text-3xl leading-tight font-bold break-words",
          valueClassName
        )}
      >
        {value}
      </span>
      <div className="flex flex-col">
        <span className="text-sm font-semibold">{label}</span>
        {detail ? (
          <span className="line-clamp-1 text-xs text-navy/70">{detail}</span>
        ) : null}
      </div>
    </div>
  )
}
