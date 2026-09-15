// Phase 6 (Part B): CSV export for /admin/reports. These files are opened
// in Excel/Sheets, which both still auto-evaluate a cell that starts with
// =, +, -, or @ as a formula -- "CSV injection" -- so any field driven by
// attacker-influenced input (a student's full_name, a session's free-text
// notes, an issue description) must be neutralised before it reaches a
// cell, not just quoted. Escaping is written once here and used for every
// field in every export (src/app/admin/reports/export/*/route.ts) rather
// than re-implemented per export.

// Leading tab/CR are included alongside =/+/-/@ because Excel treats a
// tab- or carriage-return-prefixed cell as launching a formula the same
// way a leading = does, when the file is opened rather than pasted.
const FORMULA_TRIGGER_CHARS = new Set(["=", "+", "-", "@", "\t", "\r"])

/**
 * Escapes one value for a single CSV field: neutralises a leading formula
 * trigger by prefixing a `'`, then quotes the field if it contains a comma,
 * quote, or newline, doubling any embedded quotes. Applied uniformly --
 * every field of every export row goes through this, not just the ones
 * that look risky today.
 */
export function csvField(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value)

  if (text.length > 0 && FORMULA_TRIGGER_CHARS.has(text[0])) {
    text = `'${text}`
  }

  if (/[",\r\n]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`
  }

  return text
}

/** Joins already-escaped-or-not values into one CSV row (CRLF-terminated, per RFC 4180). */
export function csvRow(values: unknown[]): string {
  return values.map(csvField).join(",") + "\r\n"
}

/** Builds a full CSV document: a header row plus one row per data record. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return csvRow(header) + rows.map((row) => csvRow(row)).join("")
}
