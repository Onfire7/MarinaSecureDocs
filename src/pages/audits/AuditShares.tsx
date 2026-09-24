import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { createAuditShare, fetchShareOptions, listAuditShares, revokeAuditShare, shareIsLive, shareUrl, type AuditShareRow } from "../../data/auditReport";
import { fmtDate, fmtDateTime } from "../../lib/auditReport";
import {
  CATEGORY_LABEL,
  describeFilter,
  tidyFilter,
  type ShareCategory,
  type ShareFilter,
  type ShareOptions,
} from "../../lib/auditShareFilter";

// Report and sharing, on every audit (AuditDetailPage.spec.md
// § Report and sharing; docs/audits.md § Share Links). Everything here is an
// online call - shares never sync to a device.
export function AuditShares({ auditId, canManage }: { auditId: string; canManage: boolean }) {
  const [shares, setShares] = useState<AuditShareRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [expiry, setExpiry] = useState<"90" | "30" | "never">("90");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; copied: boolean } | null>(null);
  const [opts, setOpts] = useState<ShareOptions | null>(null);
  const [picking, setPicking] = useState(false);
  /** What the next link leaves out. Ticked means shown, so an untouched
   *  form is the whole report. */
  const [filter, setFilter] = useState<ShareFilter>({});

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
  useEffect(() => {
    if (!canManage) return;
    fetchShareOptions(auditId)
      .then(setOpts)
      .catch(() => setOpts(null));
  }, [canManage, auditId]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const expiresAt = expiry === "never" ? null : new Date(Date.now() + Number(expiry) * 86_400_000).toISOString();
      const row = await createAuditShare(auditId, label, expiresAt, tidyFilter(filter, opts?.targets.length ?? 0));
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
      setFilter({});
      setPicking(false);
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

  // Ticked means shown. The filter holds what is NOT shown, except for
  // locations, where it holds the ones that are - which is what the
  // database reads (an empty list meaning "every one").
  const hides = (k: "categories" | "services" | "amenities" | "attributes" | "questions", id: string) =>
    (filter[k] ?? []).includes(id);
  const toggle = (k: "categories" | "services" | "amenities" | "attributes" | "questions", id: string) =>
    setFilter((f) => {
      const next = new Set(f[k] ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...f, [k]: [...next] };
    });
  const allTargets = opts?.targets.map((t) => t.id) ?? [];
  const shownTargets = new Set(filter.targets?.length ? filter.targets : allTargets);
  const setTargets = (ids: Set<string>) => setFilter((f) => ({ ...f, targets: ids.size === allTargets.length ? [] : [...ids] }));
  const toggleTarget = (id: string) => {
    const next = new Set(shownTargets);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setTargets(next);
  };
  const areas = [...new Set((opts?.targets ?? []).map((t) => t.area ?? ""))];
  const toggleArea = (area: string) => {
    const inArea = (opts?.targets ?? []).filter((t) => (t.area ?? "") === area).map((t) => t.id);
    const next = new Set(shownTargets);
    if (inArea.every((id) => next.has(id))) inArea.forEach((id) => next.delete(id));
    else inArea.forEach((id) => next.add(id));
    setTargets(next);
  };
  // Only what this audit actually asked about is offered.
  const categories: { key: ShareCategory; entries: { id: string; label: string }[] }[] = opts
    ? [
        ...(opts.kind === "occupancy" ? [{ key: "occupancy" as const, entries: [] }] : []),
        ...(opts.attributes.length ? [{ key: "attributes" as const, entries: opts.attributes.map((x) => ({ id: x.id, label: x.name })) }] : []),
        ...(opts.services.length ? [{ key: "services" as const, entries: opts.services.map((x) => ({ id: x.id, label: x.name })) }] : []),
        ...(opts.amenities.length ? [{ key: "amenities" as const, entries: opts.amenities.map((x) => ({ id: x.id, label: x.name })) }] : []),
        ...(opts.questions.length ? [{ key: "questions" as const, entries: opts.questions.map((x) => ({ id: x.id, label: x.prompt })) }] : []),
        ...(opts.kind === "status" && opts.includeMarked ? [{ key: "marked" as const, entries: [] }] : []),
        ...(opts.kind === "status" && opts.includeMap ? [{ key: "map" as const, entries: [] }] : []),
        { key: "gps" as const, entries: [] },
        { key: "changes" as const, entries: [] },
        { key: "tickets" as const, entries: [] },
      ]
    : [];
  const entryKey = (c: ShareCategory) => (c === "questions" ? "questions" : c) as "services" | "amenities" | "attributes" | "questions";

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
          {opts && (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn-sm btn-bare" data-testid="share-filter-toggle" onClick={() => setPicking((v) => !v)}>
                {picking ? "▾" : "▸"} What this link shows: <b>{describeFilter(tidyFilter(filter, allTargets.length), opts)}</b>
              </button>
              {picking && (
                <div className="share-filter" data-testid="share-filter">
                  <div className="share-filter-col">
                    <div className="wz-b-group">Items</div>
                    {categories.map((c) => (
                      <div key={c.key}>
                        <label className="share-filter-row">
                          <input
                            type="checkbox"
                            data-testid="share-cat"
                            data-cat={c.key}
                            checked={!hides("categories", c.key)}
                            onChange={() => toggle("categories", c.key)}
                          />
                          {CATEGORY_LABEL[c.key]}
                        </label>
                        {!hides("categories", c.key) &&
                          c.entries.map((e) => (
                            <label key={e.id} className="share-filter-row indent">
                              <input
                                type="checkbox"
                                data-testid="share-entry"
                                checked={!hides(entryKey(c.key), e.id)}
                                onChange={() => toggle(entryKey(c.key), e.id)}
                              />
                              {e.label}
                            </label>
                          ))}
                      </div>
                    ))}
                  </div>
                  <div className="share-filter-col">
                    <div className="wz-b-group">Locations · {shownTargets.size} of {allTargets.length}</div>
                    {areas.map((area) => {
                      const inArea = (opts.targets ?? []).filter((t) => (t.area ?? "") === area);
                      const all = inArea.every((t) => shownTargets.has(t.id));
                      return (
                        <div key={area || "none"}>
                          <label className="share-filter-row">
                            <input
                              type="checkbox"
                              data-testid="share-area"
                              checked={all}
                              ref={(el) => {
                                if (el) el.indeterminate = !all && inArea.some((t) => shownTargets.has(t.id));
                              }}
                              onChange={() => toggleArea(area)}
                            />
                            {area || "No area"}
                          </label>
                          {inArea.map((t) => (
                            <label key={t.id} className="share-filter-row indent">
                              <input type="checkbox" data-testid="share-target" checked={shownTargets.has(t.id)} onChange={() => toggleTarget(t.id)} />
                              {t.name}
                            </label>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
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
                      <td>
                        {s.label ?? <span className="muted">unlabelled</span>}
                        <div className="muted small" data-testid="share-shows">{describeFilter(s.filter, opts)}</div>
                      </td>
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
