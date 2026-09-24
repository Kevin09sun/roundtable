import { headers } from "next/headers"

/**
 * The site origin, derived from the incoming request headers rather than a
 * hardcoded env var, so email redirect links are correct in every
 * environment (localhost, preview, production) without extra config.
 */
export async function getOrigin() {
  const requestHeaders = await headers()
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http"
  return `${protocol}://${host}`
}
