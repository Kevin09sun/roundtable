// Pure functions that build the {subject, text, html} for every outgoing
// email. No I/O here -- src/lib/email/send.ts is the only thing that
// actually talks to SMTP -- so these are trivial to unit test (see
// templates.test.ts) without mocking nodemailer.
//
// Every interpolated value is HTML-escaped before it lands in the `html`
// output. Names in particular are attacker-influenced (a user sets their
// own full_name at signup/onboarding), so this must hold even though the
// values feel like "just a name".

const NAVY = "#052942"
const GREEN = "#006548"

/** Escapes the five HTML-significant characters. Used for every value
 * interpolated into an email's `html` field below. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

export type EmailContent = { subject: string; text: string; html: string }

/** Wraps a body in the shared inline-styled shell every email uses --
 * simple, table-free, and safe in the plainest email clients. */
function layout(preheading: string, bodyHtml: string): string {
  return `
    <div style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: ${NAVY};">
      <div style="background: ${NAVY}; padding: 20px 24px; border-radius: 8px 8px 0 0;">
        <span style="color: #ffffff; font-size: 18px; font-weight: 600;">Roundtable Peer Tutoring</span>
      </div>
      <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; padding: 24px;">
        <p style="margin: 0 0 8px; font-size: 13px; color: #6b7280;">${preheading}</p>
        ${bodyHtml}
      </div>
    </div>
  `
}

function button(href: string, label: string): string {
  return `<a href="${href}" style="display: inline-block; background: ${GREEN}; color: #ffffff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 600;">${escapeHtml(
    label
  )}</a>`
}

export type WelcomeEmailInput = {
  fullName: string
  appUrl: string
  needsEmailConfirmation: boolean
}

export function welcomeEmail({
  fullName,
  appUrl,
  needsEmailConfirmation,
}: WelcomeEmailInput): EmailContent {
  const dashboardUrl = `${appUrl}/dashboard`
  const safeName = escapeHtml(fullName)

  const confirmationText = needsEmailConfirmation
    ? "Before you can sign in, please click the confirmation link in the separate email we just sent you to verify your address.\n\n"
    : ""
  const confirmationHtml = needsEmailConfirmation
    ? `<p style="margin: 0 0 16px;">Before you can sign in, please click the confirmation link in the <strong>separate email</strong> we just sent you to verify your address.</p>`
    : ""

  const text =
    `Welcome to the Roundtable Peer Tutoring Program, ${fullName}!\n\n` +
    `Your account has been created.\n\n` +
    confirmationText +
    `Next steps: head to your dashboard to offer to tutor a subject or request help from a tutor.\n` +
    `${dashboardUrl}\n`

  const html = layout(
    "Your Roundtable account is ready.",
    `
      <p style="margin: 0 0 16px;">Welcome to the <strong>Roundtable Peer Tutoring Program</strong>, ${safeName}!</p>
      <p style="margin: 0 0 16px;">Your account has been created.</p>
      ${confirmationHtml}
      <p style="margin: 0 0 20px;">Next steps: head to your dashboard to offer to tutor a subject or request help from a tutor.</p>
      ${button(dashboardUrl, "Go to your dashboard")}
    `
  )

  return {
    subject: "Welcome to Roundtable Peer Tutoring",
    text,
    html,
  }
}

export type PairingEmailInput = {
  recipientName: string
  role: "tutor" | "tutee"
  partnerName: string
  partnerEmail: string
  subjectName: string
  pairingUrl: string
}

export function pairingEmail({
  recipientName,
  role,
  partnerName,
  partnerEmail,
  subjectName,
  pairingUrl,
}: PairingEmailInput): EmailContent {
  const partnerRole = role === "tutor" ? "tutee" : "tutor"
  const safeRecipientName = escapeHtml(recipientName)
  const safePartnerName = escapeHtml(partnerName)
  const safePartnerEmail = escapeHtml(partnerEmail)
  const safeSubjectName = escapeHtml(subjectName)

  const text =
    `Hi ${recipientName},\n\n` +
    `You've been paired as a ${role} with ${partnerName} (your ${partnerRole}) for ${subjectName}.\n\n` +
    `You can reach ${partnerName} at ${partnerEmail}. Please contact each other to arrange a location and ` +
    `time to meet, then record the agreed meeting time on your pairing page:\n` +
    `${pairingUrl}\n`

  const html = layout(
    `You've been paired for ${safeSubjectName}.`,
    `
      <p style="margin: 0 0 16px;">Hi ${safeRecipientName},</p>
      <p style="margin: 0 0 16px;">
        You've been paired as a <strong>${role}</strong> with <strong>${safePartnerName}</strong>
        (your ${partnerRole}) for <strong>${safeSubjectName}</strong>.
      </p>
      <p style="margin: 0 0 16px;">
        You can reach ${safePartnerName} at
        <a href="mailto:${safePartnerEmail}" style="color: ${GREEN};">${safePartnerEmail}</a>.
        Please contact each other to arrange a location and time to meet, then record the agreed
        meeting time on your pairing page.
      </p>
      ${button(pairingUrl, "View your pairing")}
    `
  )

  return {
    subject: `You've been paired for ${subjectName}`,
    text,
    html,
  }
}
