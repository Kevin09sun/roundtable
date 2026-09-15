import { describe, expect, it } from "vitest"
import { csvField, csvRow, toCsv } from "@/lib/csv"

// Plain unit tests, no DB -- see src/lib/utils.test.ts for the pattern.
// The thing under test is CSV-injection escaping: these exports
// (src/app/admin/reports/export/*/route.ts) are opened in Excel/Sheets,
// which auto-evaluates a cell starting with =, +, -, @, tab, or CR as a
// formula. Student names and free-text notes are attacker-influenced input
// here (anyone can set their own full_name via onboarding), so this must
// hold for every field, not just the ones that look risky.

describe("csvField", () => {
  it("passes an ordinary value through unchanged", () => {
    expect(csvField("Ada Lovelace")).toBe("Ada Lovelace")
  })

  it("neutralises a leading = with a leading single quote", () => {
    expect(csvField("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)")
  })

  it("neutralises a leading +", () => {
    expect(csvField("+1+1")).toBe("'+1+1")
  })

  it("neutralises a leading -", () => {
    expect(csvField("-2+3")).toBe("'-2+3")
  })

  it("neutralises a leading @", () => {
    expect(csvField("@SUM(A1:A9)")).toBe("'@SUM(A1:A9)")
  })

  it("neutralises a leading tab", () => {
    expect(csvField("\t=cmd()")).toBe("'\t=cmd()")
  })

  it("neutralises a leading carriage return, and quotes it (an embedded CR requires quoting under RFC 4180 regardless)", () => {
    expect(csvField("\r=cmd()")).toBe('"\'\r=cmd()"')
  })

  it("does not touch a formula trigger character that isn't leading", () => {
    expect(csvField("A=B+C")).toBe("A=B+C")
  })

  it("quotes a field containing a comma", () => {
    expect(csvField("Smith, Jane")).toBe('"Smith, Jane"')
  })

  it("quotes and doubles embedded quotes", () => {
    expect(csvField('she said "hi"')).toBe('"she said ""hi"""')
  })

  it("quotes a field containing a newline", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"')
  })

  it("escapes a leading formula trigger AND quotes when a comma is also present", () => {
    expect(csvField("=A1,B1")).toBe('"\'=A1,B1"')
  })

  it("renders null and undefined as an empty field", () => {
    expect(csvField(null)).toBe("")
    expect(csvField(undefined)).toBe("")
  })

  it("stringifies a number without quoting or escaping", () => {
    expect(csvField(42)).toBe("42")
  })
})

describe("csvRow", () => {
  it("joins escaped fields with commas and terminates with CRLF", () => {
    expect(csvRow(["a", "b, c", "=evil()"])).toBe('a,"b, c",\'=evil()\r\n')
  })
})

describe("toCsv", () => {
  it("builds a header row plus one row per record, all fields escaped", () => {
    const csv = toCsv(
      ["Name", "Notes"],
      [
        ["Jane Smith", "=cmd()"],
        ["Bob, Jr.", "fine"],
      ]
    )
    expect(csv).toBe("Name,Notes\r\n" + "Jane Smith,'=cmd()\r\n" + '"Bob, Jr.",fine\r\n')
  })
})
