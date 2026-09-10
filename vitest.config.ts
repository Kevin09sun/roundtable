import { defineConfig } from "vitest/config";
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Load .env.local so the Supabase RLS integration tests (which talk to the
// real hosted project, see src/lib/supabase/rls.integration.test.ts) can
// read NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY the same
// way the Next.js app does. Passed via `test.env` (rather than relying on
// process.env mutation here) so it reaches tests regardless of which
// Vitest worker pool is in use.
const { parsed: envLocal } = loadEnv({
  path: path.resolve(__dirname, ".env.local"),
  quiet: true,
});

export default defineConfig({
  test: {
    environment: "node",
    env: envLocal ?? {},
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
