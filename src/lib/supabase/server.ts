import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"

/**
 * Supabase client for use in Server Components, Server Actions, and Route
 * Handlers. Must be created fresh on every call because it reads cookies
 * from the current request via `next/headers`.
 *
 * Uses the current `@supabase/ssr` cookie API (`getAll`/`setAll`) — the
 * older `get`/`set`/`remove` methods are deprecated and break auth.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing user
            // sessions (see `src/lib/supabase/middleware.ts`).
          }
        },
      },
    }
  )
}
