import { describe, expect, it } from "vitest"
import { pairingEmail, welcomeEmail } from "@/lib/email/templates"

// Plain unit tests, no I/O -- these functions just build strings. See
// src/lib/csv.test.ts for the pattern. The thing worth testing is (a) the
// right content shows up in both subject/text/html, (b) HTML escaping of
// attacker-influenced values (full_name is user-set), and (c) the
// tutor/tutee wording actually differs by role.

describe("welcomeEmail", () => {
  it("welcomes the user, confirms account creation, and links to the dashboard", () => {
    const { subject, text, html } = welcomeEmail({
      fullName: "Ada Lovelace",
      appUrl: "https://roundtable.example.com",
      needsEmailConfirmation: false,
    })

    expect(subject).toMatch(/welcome/i)
    expect(text).toContain("Roundtable Peer Tutoring Program")
    expect(text).toContain("Ada Lovelace")
    expect(text).toContain("https://roundtable.example.com/dashboard")
    expect(html).toContain("Roundtable Peer Tutoring Program")
    expect(html).toContain("https://roundtable.example.com/dashboard")
  })

  it("mentions offering to tutor and requesting help as next steps", () => {
    const { text } = welcomeEmail({
      fullName: "Ada",
      appUrl: "https://roundtable.example.com",
      needsEmailConfirmation: false,
    })

    expect(text).toMatch(/offer to tutor/i)
    expect(text).toMatch(/request help/i)
  })

  it("tells an unconfirmed user to click the separate confirmation link first", () => {
    const { text, html } = welcomeEmail({
      fullName: "Ada",
      appUrl: "https://roundtable.example.com",
      needsEmailConfirmation: true,
    })

    expect(text).toMatch(/confirmation link/i)
    expect(text).toMatch(/separate email/i)
    expect(html).toMatch(/confirmation link/i)
  })

  it("omits confirmation instructions when no confirmation is needed", () => {
    const { text, html } = welcomeEmail({
      fullName: "Ada",
      appUrl: "https://roundtable.example.com",
      needsEmailConfirmation: false,
    })

    expect(text).not.toMatch(/confirmation link/i)
    expect(html).not.toMatch(/confirmation link/i)
  })

  it("HTML-escapes a full_name containing a script tag", () => {
    const { html } = welcomeEmail({
      fullName: "<script>alert(1)</script>",
      appUrl: "https://roundtable.example.com",
      needsEmailConfirmation: false,
    })

    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })
})

describe("pairingEmail", () => {
  it("tells the tutor who their tutee is, the subject, and the partner's email", () => {
    const { subject, text, html } = pairingEmail({
      recipientName: "Grace Hopper",
      role: "tutor",
      partnerName: "Alan Turing",
      partnerEmail: "alan@crescentschool.org",
      subjectName: "Calculus",
      pairingUrl: "https://roundtable.example.com/pairings/123",
    })

    expect(subject).toContain("Calculus")
    expect(text).toContain("Grace Hopper")
    expect(text).toMatch(/paired as a tutor/i)
    expect(text).toContain("Alan Turing")
    expect(text).toContain("alan@crescentschool.org")
    expect(text).toContain("Calculus")
    expect(text).toContain("https://roundtable.example.com/pairings/123")
    expect(html).toContain("alan@crescentschool.org")
  })

  it("tells the tutee who their tutor is, with tutee-specific wording", () => {
    const { text } = pairingEmail({
      recipientName: "Alan Turing",
      role: "tutee",
      partnerName: "Grace Hopper",
      partnerEmail: "grace@crescentschool.org",
      subjectName: "Calculus",
      pairingUrl: "https://roundtable.example.com/pairings/123",
    })

    expect(text).toMatch(/paired as a tutee/i)
    expect(text).toContain("your tutor")
    expect(text).toContain("Grace Hopper")
  })

  it("asks both parties to arrange a location and time and record it on the pairing page", () => {
    const { text, html } = pairingEmail({
      recipientName: "Grace Hopper",
      role: "tutor",
      partnerName: "Alan Turing",
      partnerEmail: "alan@crescentschool.org",
      subjectName: "Calculus",
      pairingUrl: "https://roundtable.example.com/pairings/123",
    })

    expect(text).toMatch(/location and time/i)
    expect(text).toMatch(/record the agreed meeting time/i)
    expect(html).toContain("https://roundtable.example.com/pairings/123")
  })

  it("HTML-escapes a partner name containing a script tag", () => {
    const { html } = pairingEmail({
      recipientName: "Grace Hopper",
      role: "tutor",
      partnerName: "<script>alert(1)</script>",
      partnerEmail: "alan@crescentschool.org",
      subjectName: "Calculus",
      pairingUrl: "https://roundtable.example.com/pairings/123",
    })

    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("HTML-escapes a subject name containing a script tag", () => {
    const { html } = pairingEmail({
      recipientName: "Grace Hopper",
      role: "tutor",
      partnerName: "Alan Turing",
      partnerEmail: "alan@crescentschool.org",
      subjectName: "<script>alert(1)</script>",
      pairingUrl: "https://roundtable.example.com/pairings/123",
    })

    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })
})
