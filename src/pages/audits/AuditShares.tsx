import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createAuditShare, listAuditShares, revokeAuditShare, shareIsLive, shareUrl, type AuditShareRow } from "../../data/auditReport";
import { fmtDate, fmtDateTime } from "../../lib/auditReport";

// Report and sharing, on a closed or finalized audit (AuditDetailPage.spec.md
// § Report and sharing; docs/audits.md § Share Links). Everything here is an
// online call - shares never sync to a device.
export function AuditShares({ auditId, canManage }: { auditId: string; canManage: boolean }) {
  const [shares, setShares] = useState<AuditShareRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState<"90" | "30" | "never">("90");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; copied: boolean } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setShares(await listAuditShares(auditId));
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e));
    }
  }, [auditId]);
  useEffect(() => {
    if (canManage) void refresh();
  }, [canManage, refresh]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const expiresAt = expiry === "never" ? null : new Date(Date.now() + Number(expiry) * 86_400_000).toISOString();
      const row = await createAuditShare(auditId, label, expiresAt);
      const url = shareUrl(row.key);
      let copied = false;
      try {
        await navigator.clipboard.writeText(url);
        copied = true;
      } catch {
        /* no clipboard - the URL is shown instead */
      }
      setCreated({ url, copied });
      setLabel("");
      await refresh();
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (s: AuditShareRow) => {
    if (!window.confirm(`Revoke this link${s.label ? ` (${s.label})` : ""}? Anyone holding it loses access at once.`)) return;
    setError(null);
    try {
      await revokeAuditShare(s.id);
      await refresh();
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e));
    }
  };
  const copy = async (s: AuditShareRow) => {
    const url = shareUrl(s.key);
    try {
      await navigator.clipboard.writeText(url);
      setCreated({ url, copied: true });
    } catch {
      setCreated({ url, copied: false });
    }
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-kicker">
        <span>Report</span>
        <Link to={`/audits/${auditId}/report`} className="btn btn-sm" data-testid="view-report">
          View report
        </Link>
      </div>
      {canManage && (
        <>
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input className="input" style={{ maxWidth: 220 }} placeholder="Who is it for? (label)" aria-label="Share label" value={label} onChange={(e) => setLabel(e.target.value)} />
            <select className="select" aria-label="Expires" value={expiry} onChange={(e) => setExpiry(e.target.value as typeof expiry)} style={{ width: "auto" }}>
              <option value="90">Expires in 90 days</option>
              <option value="30">Expires in 30 days</option>
              <option value="never">Never expires</option>
            </select>
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} data-testid="create-share" onClick={() => void create()}>
              Create link
            </button>
          </div>
          {created && (
            <div className="row" style={{ gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code className="small" data-testid="share-url" style={{ wordBreak: "break-all" }}>{created.url}</code>
              <span className="badge badge-good">{created.copied ? "copied" : "copy it from here"}</span>
            </div>
          )}
          {error && <div className="badge badge-bad" style={{ marginTop: 8 }}>{error}</div>}
          {shares && shares.length > 0 && (
            <table className="table" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Shared with</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th className="num">Views</th>
                  <th>Last viewed</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shares.map((s) => {
                  const live = shareIsLive(s);
                  return (
                    <tr key={s.id} data-testid="share-row" style={live ? undefined : { textDecoration: "line-through", opacity: 0.6 }}>
                      <td>{s.label ?? <span className="muted">unlabelled</span>}</td>
                      <td className="muted small">{fmtDate(s.created_at)}</td>
                      <td className="muted small">{s.revoked_at ? `revoked ${fmtDate(s.revoked_at)}` : s.expires_at ? fmtDate(s.expires_at) : "never"}</td>
                      <td className="num" data-testid="share-views">{s.view_count}</td>
                      <td className="muted small">{s.last_viewed_at ? fmtDateTime(s.last_viewed_at) : "-"}</td>
                      <td>
                        {live && (
                          <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                            <button type="button" className="btn btn-sm" onClick={() => void copy(s)}>Copy link</button>
                            <button type="button" className="btn btn-sm btn-danger" data-testid="revoke-share" onClick={() => void revoke(s)}>Revoke</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {shares && shares.length === 0 && <p className="muted small" style={{ margin: "8px 0 0" }}>Not shared yet.</p>}
        </>
      )}
    </div>
  );
}
