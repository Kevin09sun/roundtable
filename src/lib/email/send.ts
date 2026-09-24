import nodemailer from "nodemailer"

// Gmail SMTP via nodemailer, authenticated with an app password (not the
// account password -- requires 2-Step Verification on the sending Google
// account, see .env.example). GMAIL_USER / GMAIL_APP_PASSWORD are
// server-only (no NEXT_PUBLIC_ prefix) and must never reach the client
// bundle.
//
// Email is a side effect of user-facing actions (signup, pairing creation),
// never a precondition for them: sendEmail never throws, and every failure
// mode -- missing config, a rejected send, a network error -- resolves to
// `false` instead of propagating. Callers that care can check the return
// value for logging; none of them should let it block or fail the action
// it's attached to.

let warnedMissingConfig = false

function getTransport() {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD

  if (!user || !pass) {
    if (!warnedMissingConfig) {
      console.warn(
        "GMAIL_USER / GMAIL_APP_PASSWORD are not set -- outgoing email is disabled, sends will be skipped."
      )
      warnedMissingConfig = true
    }
    return null
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  })
}

export type SendEmailInput = {
  to: string
  subject: string
  text: string
  html: string
}

export async function sendEmail({ to, subject, text, html }: SendEmailInput): Promise<boolean> {
  const transport = getTransport()
  if (!transport) {
    return false
  }

  try {
    await transport.sendMail({
      from: `"Roundtable Peer Tutoring" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text,
      html,
    })
    return true
  } catch (error) {
    console.error("Failed to send email:", error)
    return false
  }
}
