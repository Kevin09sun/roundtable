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
    // The RLS integration suites (src/lib/supabase/*.integration.test.ts,
    // src/lib/actions/pairing.integration.test.ts,
    // src/lib/actions/subjects.integration.test.ts) are not isolated from
    // each other the way unit tests are: they all share ONE resource, the
    // real hosted Supabase project, and sign in as the same three
    // pre-seeded fixture accounts to do it. Vitest's default file
    // parallelism runs test files concurrently in separate workers, which
    // is fine when each file owns its own state -- it is not fine here,
    // because one file's writes are visible to every other file's reads in
    // real time. Confirmed empirically: pairings-rls.integration.test.ts
    // creates a real active pairing between the fixture users and only
    // deletes it in its own afterAll, so for most of that file's run there
    // genuinely IS such a pairing in the database; profiles_select was
    // widened (20260910130000_allow_paired_profile_read.sql) to grant
    // paired users mutual read access, so rls.integration.test.ts's "does
    // NOT let a user read another user's profile row" test -- running
    // concurrently in a different worker -- observed that real pairing and
    // failed, deterministically, on a correct RLS decision. More fixture
    // identities would not fix this: the collision is over shared TABLES
    // (pairings, tutee_requests, subjects, ...), not over which accounts
    // are used, and every future integration suite touching those tables
    // would eventually find a new way to collide. Serializing file
    // execution is the actual fix; these are network-bound integration
    // tests against one project, not a large unit-test suite, so the
    // wall-clock cost is small.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
