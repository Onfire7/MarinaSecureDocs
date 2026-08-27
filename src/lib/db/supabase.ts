import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";
import { getClerkToken } from "../auth/clerkToken";

/**
 * The marina's Supabase project, authenticated as the active Clerk session.
 *
 * Almost nothing in the app uses this. Reads and writes go to the device's own
 * SQLite and reach Postgres through PowerSync's queue — that is what makes
 * them work with no signal. Two things genuinely cannot:
 *
 *   * `claim_marina_user()`, because it runs before this device has an
 *     identity and therefore before anything can sync;
 *   * attachment bytes, which PowerSync does not replicate.
 *
 * Anything else reaching for this client is a page that should be reading
 * SQLite instead, and it will be the page that stops working on a dock.
 */
export const supabase = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
  auth: {
    // Clerk owns the session. Supabase must not persist, refresh, or detect
    // one of its own — its only job is to attach the token below.
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  // Resolved per request, so a token that expired mid-shift is replaced
  // without reconstructing the client.
  accessToken: async () => (await getClerkToken()) ?? "",
});
