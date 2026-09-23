import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/config";
import type { AuditReport } from "../lib/auditReport";

// The public report page's one call (docs/api-structure.md § Public report
// links). Its own module, and its own client with the anon key and nothing
// else: a recipient has no Clerk session and no PowerSync database, and the
// page must not load either - so this must never import src/lib/db.
const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/** Null for a missing, revoked or expired key alike - the page shows one
 *  neutral message for all three. */
export async function fetchSharedReport(key: string): Promise<AuditReport | null> {
  const { data, error } = await anon.rpc("audit_report", { p_key: key });
  if (error) throw error;
  return (data as AuditReport | null) ?? null;
}
