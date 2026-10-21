import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/config";
import type { ShiftReportDoc, SinceInputs } from "../lib/shiftReportDoc";

// The public Report Link's one call (ShiftReportPage.spec.md § The Report
// Link). Its own module and its own client with the anon key and nothing
// else: a recipient has no Clerk session and no PowerSync database, and the
// page must not load either, so this must never import src/lib/db
// (src/lib/publicBundle.test.ts).
const anon = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export type SharedShiftReport =
  | { status: "ended"; document: ShiftReportDoc; updates: SinceInputs }
  | { status: "not_ended"; header: { marinaName: string | null; guardName: string | null; startedAt: string; endedAt: string | null } };

/** Null for an unknown id: the page shows one neutral message. */
export async function fetchShiftReport(shiftId: string): Promise<SharedShiftReport | null> {
  const { data, error } = await anon.rpc("shift_report", { p_shift: shiftId });
  if (error) throw error;
  return (data as SharedShiftReport | null) ?? null;
}
