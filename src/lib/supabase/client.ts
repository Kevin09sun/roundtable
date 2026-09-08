import { createBrowserClient } from "@supabase/ssr"

/**
 * Supabase client for use in Client Components (browser).
 *
 * Create a new client per call site rather than sharing a module-level
 * singleton — this matches the current `@supabase/ssr` guidance and avoids
 * stale auth state across navigations.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
