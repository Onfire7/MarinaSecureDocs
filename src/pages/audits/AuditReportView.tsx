import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  DASH,
  attention,
  fmtDate,
  fmtDateTime,
  itemRows,
  itemTable,
  narrative,
  needsAttention,
  statusWord,
  summarize,
  summaryTable,
  toCsv,
  wideHeaders,
  wideRows,
  wideTable,
  type AuditReport,
  type ItemRow,
  type ReportTarget,
  type Summary,
  type Tone,
  uniformValue,
} from "../../lib/auditReport";

// The Audit Report's view (AuditReportPage.spec.md; docs/audits.md
// § Sharing the results). Two thin pages mount it: SharedAuditReportPage
// at /r/:key, public, and AuditReportInAppPage at /audits/:id/report. This
// module imports nothing that reaches Clerk, PowerSync or the app's
// Supabase client - the public page must not load any of them - and
// nothing here assembles a report from tables; it renders the document the
// database built.

export type Loaded = { state: "loading" } | { state: "gone" } | { state: "error"; message: string } | { state: "ready"; report: AuditReport };

/** Fetch once per key. `load` must be a module-level function - the two
 *  data modules export exactly that - so the effect's dependencies are the
 *  key and a stable reference, never an inline closure that would refetch
 *  on every render. */
export function useReport(load: (key: string) => Promise<AuditReport | null>, key: string | undefined): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  useEffect(() => {
    let live = true;
    setLoaded({ state: "loading" });
    (key ? load(key) : Promise.resolve(null)).then(
      (report) => live && setLoaded(report ? { state: "ready", report } : { state: "gone" }),
      (e: unknown) => live && setLoaded({ state: "error", message: (e as { message?: string }).message ?? String(e) }),
    );
    return () => {
      live = false;
    };
  }, [load, key]);
  return loaded;
}

export function ReportBody({ loaded, inApp }: { loaded: Loaded; inApp: boolean }) {
  if (loaded.state === "loading") {
    return (
      <div className="placeholder">
        <div className="big">Assembling the report…</div>
      </div>
    );
  }
  if (loaded.state === "gone") {
    return (
      <div className="placeholder" data-testid="report-gone">
        <div className="big">This report link is no longer active.</div>
        <p className="muted">Ask the marina for a new one.</p>
      </div>
    );
  }
  if (loaded.state === "error") {
    return (
      <div className="placeholder">
        <div className="big">The report could not be loaded.</div>
        <p className="muted">{loaded.message}</p>
      </div>
    );
  }
  return <AuditReportView report={loaded.report} inApp={inApp} />;
}

export function AuditReportView({ report: r, inApp }: { report: AuditReport; inApp: boolean }) {
  const s = useMemo(() => summarize(r), [r]);
  const sentences = useMemo(() => narrative(r, s), [r, s]);
  const wide = useMemo(() => wideRows(r), [r]);
  const headers = useMemo(() => wideHeaders(r), [r]);
  const items = useMemo(() => itemRows(r), [r]);
  const [tab, setTab] = useState<"locations" | "items">("locations");
  const [state, setState] = useState<"all" | "attention" | "audited" | "not_audited">("all");
  const [q, setQ] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const attn = useMemo(() => r.targets.filter(needsAttention), [r]);
  const keep = (t: ReportTarget) =>
    (state === "all" || (state === "attention" ? needsAttention(t) : t.state === state)) &&
    (!q || `${t.name} ${t.area ?? ""} ${attention(t).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  const shownWide = wide.filter((w) => keep(w.target));
  const byId = new Map(r.targets.map((t) => [t.id, t]));
  const shownItems = items.filter((x) => keep(byId.get(x.targetId)!));
  const kind = s.kind === "occupancy" ? "Occupancy" : "Status";
  // A type or area shared by every target says nothing per row.
  const sameType = useMemo(() => uniformValue(r.targets.map((t) => t.typeName)), [r]);
  const sameArea = useMemo(() => uniformValue(r.targets.map((t) => t.area)), [r]);

  return (
    <div className="report">
      <div className="report-letterhead">
        <div>
          <div className="report-kicker">
            {r.marinaName} · {kind} audit report
          </div>
          <h1>{r.audit.name}</h1>
          <div className="muted">
            {statusWord(r.audit.status)} · launched {fmtDate(r.audit.launchedAt)}
            {r.audit.closedAt ? ` · closed ${fmtDate(r.audit.closedAt)}` : ""}
            {r.audit.finalizedAt ? ` · finalized ${fmtDate(r.audit.finalizedAt)}` : ""}
          </div>
        </div>
        <div className="report-letterhead-right muted small">
          {r.launchedBy && <div>Launched by {r.launchedBy}</div>}
          {s.auditors.length > 0 && <div>Audited by {s.auditors.join(", ")}</div>}
          <div>{r.audit.finalizedAt ? `Finalized ${fmtDate(r.audit.finalizedAt)}` : `As of ${fmtDateTime(r.asOf)}`}</div>
          <div className="row report-noprint" style={{ gap: 6, marginTop: 8, position: "relative" }}>
            <button type="button" className="btn btn-sm btn-primary" data-testid="report-export" onClick={() => setExportOpen(!exportOpen)}>
              Export…
            </button>
            {exportOpen && <ExportPanel r={r} s={s} wide={shownWide} items={shownItems} onClose={() => setExportOpen(false)} />}
          </div>
        </div>
      </div>

      <h2>Executive summary</h2>
      <div className="report-prose" data-testid="report-summary">
        {sentences.map((t, i) => (
          <p key={i} className={i === 0 ? "lede" : undefined}>
            {t}
          </p>
        ))}
      </div>

      <div className="report-kpis">
        <Kpi label="Locations" value={s.targets} />
        <Kpi label="Audited" value={`${s.coveragePct}%`} sub={`${s.audited} of ${s.targets}`} />
        {s.kind === "status" ? <Kpi label="Not working" value={s.broken.length} sub="services" /> : <Kpi label="Unexpected" value={s.unexpected.length} sub="occupancy not on file" />}
        <Kpi label="Need attention" value={attn.length} sub="locations" />
        <Kpi label="Changes" value={s.proposals.total} sub={`${s.proposals.approved} approved${s.proposals.undecided ? ` · ${s.proposals.undecided} undecided` : ""}`} />
        <Kpi label="Tickets open" value={s.tickets.open} sub={`of ${s.tickets.total} raised`} />
      </div>

      <div className="report-band">
        <div className="card">
          <div className="card-kicker"><span>Coverage</span></div>
          <CoverageBar s={s} />
        </div>
        <div className="card">
          {s.kind === "status" ? (
            <>
              <div className="card-kicker"><span>Services present · of {s.audited} audited</span></div>
              {s.services.length ? <HBars rows={s.services.map((x) => ({ label: x.name, value: x.present, of: s.audited }))} /> : <p className="muted small" style={{ margin: 0 }}>No services on this audit.</p>}
              {s.broken.length > 0 && (
                <>
                  <div className="card-kicker" style={{ marginTop: 12 }}><span>Not working</span></div>
                  <HBars rows={s.services.filter((x) => x.broken).map((x) => ({ label: x.name, value: x.broken, of: s.audited }))} bad />
                </>
              )}
            </>
          ) : (
            <>
              <div className="card-kicker"><span>Occupancy found</span></div>
              <HBars rows={[{ label: "Occupied", value: s.occupied, of: s.audited }, { label: "Vacant", value: s.vacant, of: s.audited }]} />
            </>
          )}
        </div>
        <div className="card">
          <div className="card-kicker"><span>Questions</span></div>
          {s.questions.map((qq) => {
            const total = qq.kind === "yes_no" ? qq.yes + qq.no : Object.values(qq.tally).reduce((a, b) => a + b, 0);
            return (
              <div key={qq.prompt} style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{qq.prompt}</div>
                {qq.kind === "yes_no" ? (
                  <HBars rows={[{ label: "Yes", value: qq.yes, of: total }, { label: "No", value: qq.no, of: total }]} />
                ) : (
                  <HBars rows={Object.entries(qq.tally).map(([k, v]) => ({ label: k, value: v, of: total }))} />
                )}
              </div>
            );
          })}
          {s.questions.length === 0 && <p className="muted small" style={{ margin: 0 }}>No questions on this audit.</p>}
        </div>
      </div>

      {attn.length > 0 && (
        <>
          <h2>Needs attention · {attn.length}</h2>
          <ul data-testid="report-attention">
            {attn.map((t) => (
              <li key={t.id}>
                <b>{inApp ? <Link to={`/audits/${r.audit.id}/targets/${t.id}`}>{t.name}</Link> : t.name}</b>
                {t.area && !sameArea ? <span className="muted"> ({t.area})</span> : null} — {attention(t).join("; ")}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Results</h2>
      <div className="report-toolbar report-noprint">
        <div className="report-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "locations"} className={`report-tab ${tab === "locations" ? "on" : ""}`} onClick={() => setTab("locations")}>
            Per location · {r.targets.length}
          </button>
          <button type="button" role="tab" aria-selected={tab === "items"} className={`report-tab ${tab === "items" ? "on" : ""}`} data-testid="report-tab-items" onClick={() => setTab("items")}>
            Per item · {items.length}
          </button>
        </div>
        <div className="report-filters">
          <select className="select" aria-label="Show" value={state} onChange={(e) => setState(e.target.value as typeof state)}>
            <option value="all">All locations</option>
            <option value="attention">Needs attention</option>
            <option value="audited">Audited</option>
            <option value="not_audited">Not audited</option>
          </select>
          <input className="input" placeholder="Search…" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small" data-testid="report-count">
            {tab === "locations" ? `${shownWide.length} of ${wide.length}` : `${shownItems.length} of ${items.length}`}
          </span>
        </div>
      </div>

      {tab === "locations" ? (
        <>
          <div className="report-scroll">
            <table className="table report-table report-wide" data-testid="report-locations">
              <thead>
                <tr>
                  <th>Location</th>
                  {!sameArea && <th>Area</th>}
                  {headers.map((h) => (
                    <th key={h} title={h}>
                      {h.length > 22 ? h.slice(0, 21) + "…" : h}
                    </th>
                  ))}
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {shownWide.map((w) => {
                  const t = w.target;
                  const cls = t.state === "not_audited" ? "report-row-skip" : needsAttention(t) ? "report-row-attn" : undefined;
                  return (
                    <tr key={t.id} className={cls}>
                      <td>
                        <b>{inApp && t.state === "audited" ? <Link to={`/audits/${r.audit.id}/targets/${t.id}`}>{t.name}</Link> : t.name}</b>
                        {!sameType && t.typeName ? <span className="muted small"> {t.typeName}</span> : null}
                      </td>
                      {!sameArea && <td className="muted">{t.area ?? ""}</td>}
                      {headers.map((h) => (
                        <td key={h} className={cellClass(w.cells[h])}>
                          {w.cells[h] ?? DASH}
                        </td>
                      ))}
                      <td className="muted small report-notes">{w.notes}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>
            {DASH} not recorded · <b>*</b> proposed by this audit · <b>!</b> does not match what is on file
          </p>
        </>
      ) : (
        <div className="report-scroll">
          <table className="table report-table" data-testid="report-items">
            <thead>
              <tr>
                <th>Location</th>
                {!sameArea && <th>Area</th>}
                <th>Category</th>
                <th>Item</th>
                <th>Result</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {shownItems.map((x: ItemRow, i) => (
                <tr key={i} className={x.tone === "bad" || x.tone === "warn" ? "report-row-attn" : undefined}>
                  <td><b>{x.location}</b></td>
                  {!sameArea && <td className="muted">{x.area}</td>}
                  <td className="muted">{x.category}</td>
                  <td>{x.item}</td>
                  <td><ToneBadge tone={x.tone}>{x.result}</ToneBadge></td>
                  <td className="muted">{x.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function cellClass(v: string | undefined): string | undefined {
  if (!v || v === DASH) return "report-cell-none";
  if (/^(Not working|No|Occupied !|Vacant !)$/.test(v)) return "report-cell-bad";
  if (/^(Working|Yes|Occupied|Vacant)$/.test(v)) return "report-cell-good";
  return undefined;
}

// ── pieces ───────────────────────────────────────────────────────────────

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="report-kpi">
      <div className="report-kpi-label">{label}</div>
      <div className="report-kpi-value">{value}</div>
      {sub && <div className="report-kpi-sub">{sub}</div>}
    </div>
  );
}

/** Part-to-whole with status meaning; every segment labelled, never colour alone. */
function CoverageBar({ s }: { s: Summary }) {
  const pct = (n: number) => (s.targets ? (n / s.targets) * 100 : 0);
  return (
    <div>
      <div className="report-bar" role="img" aria-label={`${s.audited} audited, ${s.notAudited} not audited, ${s.pending} pending`}>
        {s.audited > 0 && <span className="report-bar-good" style={{ width: `${pct(s.audited)}%` }} />}
        {s.notAudited > 0 && <span className="report-bar-bad" style={{ width: `${pct(s.notAudited)}%` }} />}
        {s.pending > 0 && <span className="report-bar-mute" style={{ width: `${pct(s.pending)}%` }} />}
      </div>
      <div className="report-legend">
        <span><i className="report-bar-good" /> Audited {s.audited}</span>
        <span><i className="report-bar-bad" /> Not audited {s.notAudited}</span>
        {s.pending > 0 && <span><i className="report-bar-mute" /> Pending {s.pending}</span>}
      </div>
    </div>
  );
}

/** One series, one hue, the value at the tip. `bad` = the count means trouble. */
function HBars({ rows, bad }: { rows: { label: string; value: number; of: number }[]; bad?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.of));
  return (
    <div className="report-hbars">
      {rows.map((r) => (
        <div key={r.label} className="report-hbar">
          <span>{r.label}</span>
          <div className="track">
            <div className={`fill ${bad && r.value > 0 ? "bad" : ""}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="num">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function ToneBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`badge ${tone === "none" ? "report-tone-none" : `badge-${tone}`}`}>{children}</span>;
}

// ── export ───────────────────────────────────────────────────────────────

type RowSet = "locations" | "items" | "both";

function ExportPanel({ r, s, wide, items, onClose }: { r: AuditReport; s: Summary; wide: ReturnType<typeof wideRows>; items: ItemRow[]; onClose: () => void }) {
  const [pdf, setPdf] = useState(false);
  const [xlsx, setXlsx] = useState(true);
  const [csv, setCsv] = useState(true);
  const [rows, setRows] = useState<RowSet>("locations");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const none = !pdf && !xlsx && !csv;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = r.audit.name;
      const locations = wideTable(r, wide);
      const itemsT = itemTable(items);
      if (csv) {
        if (rows !== "items") download(`${name} - locations.csv`, new Blob([toCsv(locations.headers, locations.rows)], { type: "text/csv;charset=utf-8" }));
        if (rows !== "locations") download(`${name} - items.csv`, new Blob([toCsv(itemsT.headers, itemsT.rows)], { type: "text/csv;charset=utf-8" }));
      }
      if (xlsx) {
        const blob = await workbook(r, s, rows === "items" ? null : locations, rows === "locations" ? null : itemsT);
        download(`${name}.xlsx`, blob);
      }
      if (pdf) window.print();
      onClose();
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card report-export" data-testid="report-export-panel">
      <div className="card-kicker"><span>Export</span></div>
      <div className="stack" style={{ gap: 6 }}>
        <label><input type="checkbox" checked={pdf} onChange={(e) => setPdf(e.target.checked)} /> PDF (print)</label>
        <label><input type="checkbox" checked={xlsx} onChange={(e) => setXlsx(e.target.checked)} /> Excel (.xlsx)</label>
        <label><input type="checkbox" checked={csv} onChange={(e) => setCsv(e.target.checked)} /> CSV</label>
        <div className="muted small" style={{ marginTop: 6 }}>Rows</div>
        <select className="select" aria-label="Rows" value={rows} onChange={(e) => setRows(e.target.value as RowSet)}>
          <option value="locations">Per location (as filtered)</option>
          <option value="items">Per item (as filtered)</option>
          <option value="both">Both</option>
        </select>
        {error && <div className="badge badge-bad">{error}</div>}
        <div className="row" style={{ gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={none || busy} data-testid="report-export-run" onClick={() => void run()}>
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** One workbook: Summary, then Locations and/or Items. exceljs is loaded
 *  only here, so the report page pays nothing for it until someone exports. */
async function workbook(
  r: AuditReport,
  s: Summary,
  locations: { headers: string[]; rows: (string | number)[][] } | null,
  items: { headers: string[]; rows: (string | number)[][] } | null,
): Promise<Blob> {
  const { Workbook } = await import("exceljs");
  const wb = new Workbook();
  wb.creator = "MarinaSecure";
  const sum = wb.addWorksheet("Summary");
  sum.addRows(summaryTable(r, s));
  sum.getColumn(1).width = 24;
  sum.getColumn(2).width = 60;
  const sheet = (title: string, t: { headers: string[]; rows: (string | number)[][] }) => {
    const ws = wb.addWorksheet(title);
    ws.addRow(t.headers).font = { bold: true };
    ws.addRows(t.rows);
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
    t.headers.forEach((h, i) => {
      ws.getColumn(i + 1).width = Math.min(40, Math.max(10, h.length + 2));
    });
  };
  if (locations) sheet("Locations", locations);
  if (items) sheet("Items", items);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
