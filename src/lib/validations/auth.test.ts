import { describe, expect, it } from "vitest"
import {
  isCrescentEmail,
  loginSchema,
  signupSchema,
} from "@/lib/validations/auth"

// Plain unit tests, no DB -- see src/lib/utils.test.ts for the pattern.
// The real enforcement boundary is the auth.users trigger in
// 20260924120000_restrict_signup_to_crescent_emails.sql (it covers direct
// API signUp calls that bypass this schema); these tests only cover the
// app-level UX check.

describe("isCrescentEmail", () => {
  it("accepts a plain crescentschool.org address", () => {
    expect(isCrescentEmail("student@crescentschool.org")).toBe(true)
  })

  it("accepts mixed-case domains", () => {
    expect(isCrescentEmail("student@CrescentSchool.Org")).toBe(true)
  })

  it("accepts surrounding whitespace", () => {
    expect(isCrescentEmail("  student@crescentschool.org  ")).toBe(true)
  })

  it("rejects a different domain", () => {
    expect(isCrescentEmail("student@gmail.com")).toBe(false)
  })

  it("rejects a lookalike domain that merely contains crescentschool.org as a substring", () => {
    expect(isCrescentEmail("student@evilcrescentschool.org")).toBe(false)
  })

  it("rejects a subdomain-suffix trick appended after the real domain", () => {
    expect(isCrescentEmail("student@crescentschool.org.evil.com")).toBe(false)
  })

  it("rejects an email with no @ at all", () => {
    expect(isCrescentEmail("not-an-email")).toBe(false)
  })

  it("rejects an empty string", () => {
    expect(isCrescentEmail("")).toBe(false)
  })
})

describe("signupSchema", () => {
  const base = { fullName: "Ada Lovelace", password: "password123" }

  it("accepts a valid crescentschool.org email", () => {
    const result = signupSchema.safeParse({
      ...base,
      email: "ada@crescentschool.org",
    })
    expect(result.success).toBe(true)
  })

  it("accepts a mixed-case, whitespace-padded crescentschool.org email", () => {
    const result = signupSchema.safeParse({
      ...base,
      email: "  Ada@CrescentSchool.Org  ",
    })
    expect(result.success).toBe(true)
  })

  it("rejects a non-crescentschool.org email with the school-domain message", () => {
    const result = signupSchema.safeParse({
      ...base,
      email: "ada@gmail.com",
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Use your @crescentschool.org school email."
      )
    }
  })

  it("rejects a lookalike domain", () => {
    const result = signupSchema.safeParse({
      ...base,
      email: "ada@evilcrescentschool.org",
    })
    expect(result.success).toBe(false)
  })

  it("rejects a subdomain-suffix trick", () => {
    const result = signupSchema.safeParse({
      ...base,
      email: "ada@crescentschool.org.evil.com",
    })
    expect(result.success).toBe(false)
  })

  it("rejects a malformed email before the domain check even applies", () => {
    const result = signupSchema.safeParse({
      ...base,
      email: "not-an-email",
    })
    expect(result.success).toBe(false)
  })
})

describe("loginSchema", () => {
  it("still accepts a non-crescentschool.org (e.g. gmail) address", () => {
    // Existing test/admin accounts predate the Crescent-only signup
    // restriction and must still be able to log in.
    const result = loginSchema.safeParse({
      email: "admin@gmail.com",
      password: "whatever",
    })
    expect(result.success).toBe(true)
  })
})
