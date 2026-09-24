import { supabase } from "../lib/db/supabase";
import type { AuditReport } from "../lib/auditReport";
import type { ShareFilter, ShareOptions } from "../lib/auditShareFilter";

// The Audit Report in-app and its Share Links (docs/audits.md § Sharing
// the results; docs/api-structure.md § Public report links). The public
// page's call is src/data/sharedReport.ts, kept apart because this module
// reaches the Clerk-authenticated client. Everything here is an ONLINE
// call, deliberately: the document is built once, in the
// database, and neither shares nor snapshots sync to a device - a share
// key in a guard's SQLite would be a credential lying around. A report is
// read at a desk, not on a dock with no signal.

/** The in-app view: any active marina user. */
export async function fetchAuditReport(auditId: string): Promise<AuditReport | null> {
  const { data, error } = await supabase.rpc("audit_report_for", { p_audit: auditId });
  if (error) throw error;
  return (data as AuditReport | null) ?? null;
}

export interface AuditShareRow {
  id: string;
  audit_id: string;
  key: string;
  label: string | null;
  created_by_id: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  view_count: number;
  last_viewed_at: string | null;
  /** What this link leaves out; `{}` is everything. Enforced in the
   *  database - see docs/audits.md § A link can show less. */
  filter: ShareFilter | null;
}

/** Read under RLS: only a manage_audits holder sees any rows. */
export async function listAuditShares(auditId: string): Promise<AuditShareRow[]> {
  const { data, error } = await supabase.from("audit_shares").select("*").eq("audit_id", auditId).order("created_at");
  if (error) throw error;
  return (data ?? []) as AuditShareRow[];
}

/** `expiresAt` null means never; an empty filter means the whole report. */
export async function createAuditShare(
  auditId: string,
  label: string,
  expiresAt: string | null,
  filter: ShareFilter = {},
): Promise<AuditShareRow> {
  const { data, error } = await supabase.rpc("create_audit_share", {
    p_audit: auditId,
    p_label: label,
    p_expires_at: expiresAt,
    p_filter: filter,
  });
  if (error) throw error;
  return data as AuditShareRow;
}

/** What the share form offers: exactly what this audit asked about, by id,
 *  which is what a filter stores. */
export async function fetchShareOptions(auditId: string): Promise<ShareOptions | null> {
  const { data, error } = await supabase.rpc("audit_share_options", { p_audit: auditId });
  if (error) throw error;
  return (data as ShareOptions | null) ?? null;
}

export async function revokeAuditShare(shareId: string): Promise<void> {
  const { error } = await supabase.rpc("revoke_audit_share", { p_share: shareId });
  if (error) throw error;
}

export function shareUrl(key: string): string {
  return `${window.location.origin}/r/${key}`;
}
export function shareIsLive(s: AuditShareRow, now = Date.now()): boolean {
  return !s.revoked_at && (!s.expires_at || new Date(s.expires_at).getTime() > now);
}
