// PROTOTYPE — throwaway. Variant D: the combination the owner asked for on
// 2026-09-23 - B's dashboard band, A's executive summary and needs-attention
// list, then two tabs: a per-location table with one column per Service,
// Amenity, Attribute and Question (the default), and B's per-item rows.
// Export asks which formats.
import { useMemo, useState } from "react";
import type { AuditReport } from "../../../data/auditReport";
import {
  DASH,
  attention,
  fmtDate,
  fmtDateTime,
  itemRows,
  narrative,
  needsAttention,
  statusWord,
  summarize,
  toCsv,
  wideHeaders,
  wideRows,
  type ItemRow,
} from "./reportModel";
import { CoverageBar, ExportButton, HBars, Kpi, Tone } from "./ui";

export const name = "Combined";

export function VariantD({ r }: { r: AuditReport }) {
  const s = useMemo(() => summarize(r), [r]);
  const sentences = useMemo(() => narrative(r, s), [r, s]);
  const wide = useMemo(() => wideRows(r), [r]);
  const headers = useMemo(() => wideHeaders(r), [r]);
  const items = useMemo(() => itemRows(r), [r]);
  const [tab, setTab] = useState<"locations" | "items">("locations");
  const [state, setState] = useState<"all" | "attention" | "audited" | "not_audited">("all");
  const [q, setQ] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const attn = r.targets.filter(needsAttention);
  const keep = (t: (typeof r.targets)[number]) =>
    (state === "all" || (state === "attention" ? needsAttention(t) : t.state === state)) &&
    (!q || `${t.name} ${t.area ?? ""} ${attention(t).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  const shownWide = wide.filter((w) => keep(w.target));
  const shownItems = items.filter((x) => {
    const t = r.targets.find((y) => y.id === x.targetId)!;
    return keep(t);
  });
  const wideCsv = () =>
    toCsv(
      ["Location", "Area", "Type", "State", ...headers, "Notes", "Changes", "Tickets", "Recorded by", "Recorded at"],
      shownWide.map((w) => [
        w.target.name,
        w.target.area ?? "",
        w.target.typeName ?? "",
        w.target.state,
        ...headers.map((h) => w.cells[h] ?? ""),
        w.notes,
        w.target.proposals.length,
        w.target.tickets.length,
        w.target.finding?.recordedBy ?? "",
        w.target.finding ? fmtDateTime(w.target.finding.recordedAt) : "",
      ]),
    );
  const itemCsv = () =>
    toCsv(
      ["Location", "Area", "Type", "Category", "Item", "Result", "Note", "Recorded by"],
      shownItems.map((x) => [x.location, x.area, x.type, x.category, x.item, x.result, x.note, x.recordedBy]),
    );

  return (
    <div className="rp-dash">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="muted small">{r.marinaName} · {s.kind === "occupancy" ? "Occupancy" : "Status"} audit report</div>
          <h1 className="page-title" style={{ fontSize: "1.5rem" }}>{r.audit.name}</h1>
          <div className="muted small">
            <Tone tone={s.status === "finalized" ? "good" : s.status === "closed" ? "warn" : "none"}>{statusWord(s.status)}</Tone>
            {" "}· launched {fmtDate(r.audit.launched_at)}
            {r.audit.closed_at ? ` · closed ${fmtDate(r.audit.closed_at)}` : ""}
            {r.audit.finalized_at ? ` · finalized ${fmtDate(r.audit.finalized_at)}` : ` · as of ${fmtDateTime(r.asOf)}`}
            {s.auditors.length ? ` · audited by ${s.auditors.join(", ")}` : ""}
          </div>
        </div>
        <div className="row rp-noprint" style={{ gap: 6, position: "relative" }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setExportOpen(!exportOpen)}>
            Export…
          </button>
          {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} wideCsv={wideCsv} itemCsv={itemCsv} auditName={r.audit.name} />}
        </div>
      </div>

      <div className="rp-kpis" style={{ marginTop: 14 }}>
        <Kpi label="Audited" value={`${s.coveragePct}%`} sub={`${s.audited} of ${s.targets} locations`} />
        {s.kind === "status" ? <Kpi label="Not working" value={s.broken.length} sub="services" /> : <Kpi label="Unexpected" value={s.unexpected.length} sub="occupancy not on file" />}
        <Kpi label="Need attention" value={attn.length} sub="locations" />
        <Kpi label="Changes" value={s.proposals.total} sub={`${s.proposals.approved} approved${s.proposals.undecided ? ` · ${s.proposals.undecided} undecided` : ""}`} />
        <Kpi label="Tickets" value={s.tickets.total} sub={`${s.tickets.open} open`} />
      </div>

      <div className="rp-dash-grid">
        <div className="card">
          <div className="card-kicker"><span>Executive summary</span></div>
          {sentences.map((t, i) => (
            <p key={i} style={{ margin: "0 0 6px", fontSize: i === 0 ? "1rem" : "0.92rem" }}>
              {t}
            </p>
          ))}
          <div style={{ marginTop: 8 }}>
            <CoverageBar s={s} />
          </div>
        </div>
        {s.kind === "status" ? (
          <>
            <div className="card">
              <div className="card-kicker"><span>Services present · of {s.audited} audited</span></div>
              <HBars rows={s.services.map((x) => ({ label: x.name, value: x.present, of: s.audited }))} />
              {s.broken.length > 0 && (
                <>
                  <div className="card-kicker" style={{ marginTop: 12 }}><span>Not working</span></div>
                  <HBars rows={s.services.filter((x) => x.broken).map((x) => ({ label: x.name, value: x.broken, of: s.audited }))} bad />
                </>
              )}
            </div>
            <div className="card">
              <div className="card-kicker"><span>Questions</span></div>
              {s.questions.map((qq) => (
                <div key={qq.prompt} style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{qq.prompt}</div>
                  {qq.kind === "yes_no" ? (
                    <HBars rows={[{ label: "Yes", value: qq.yes, of: qq.yes + qq.no }, { label: "No", value: qq.no, of: qq.yes + qq.no }]} />
                  ) : (
                    <HBars rows={Object.entries(qq.tally).map(([k, v]) => ({ label: k, value: v, of: Object.values(qq.tally).reduce((a, b) => a + b, 0) }))} />
                  )}
                </div>
              ))}
              {s.questions.length === 0 && <p className="muted small" style={{ margin: 0 }}>No questions on this audit.</p>}
            </div>
          </>
        ) : (
          <>
            <div className="card">
              <div className="card-kicker"><span>Occupancy found</span></div>
              <HBars rows={[{ label: "Occupied", value: s.occupied, of: s.audited }, { label: "Vacant", value: s.vacant, of: s.audited }]} />
            </div>
            <div className="card">
              <div className="card-kicker"><span>Questions</span></div>
              {s.questions.map((qq) => (
                <div key={qq.prompt} style={{ marginBottom: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{qq.prompt}</div>
                  <HBars rows={[{ label: "Yes", value: qq.yes, of: qq.yes + qq.no }, { label: "No", value: qq.no, of: qq.yes + qq.no }]} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {attn.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-kicker"><span>Needs attention · {attn.length}</span></div>
          <ul style={{ margin: 0, paddingLeft: 20, columns: attn.length > 8 ? 2 : 1, columnGap: 32 }}>
            {attn.map((t) => (
              <li key={t.id} style={{ breakInside: "avoid", marginBottom: 3 }}>
                <b>{t.name}</b>
                {t.area ? <span className="muted"> ({t.area})</span> : null} — {attention(t).join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div className="rp-facets">
          <button type="button" className={`rp-facet ${tab === "locations" ? "on" : ""}`} onClick={() => setTab("locations")}>Per location · {r.targets.length}</button>
          <button type="button" className={`rp-facet ${tab === "items" ? "on" : ""}`} onClick={() => setTab("items")}>Per item · {items.length}</button>
        </div>
        <div className="rp-filters rp-noprint" style={{ margin: 0 }}>
          <select className="select" value={state} onChange={(e) => setState(e.target.value as typeof state)}>
            <option value="all">All locations</option>
            <option value="attention">Needs attention</option>
            <option value="audited">Audited</option>
            <option value="not_audited">Not audited</option>
          </select>
          <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="rp-count">{tab === "locations" ? `${shownWide.length} of ${wide.length}` : `${shownItems.length} of ${items.length}`}</span>
        </div>
      </div>

      {tab === "locations" ? (
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table className="table rp-table rp-wide">
            <thead>
              <tr>
                <th>Location</th>
                <th>Area</th>
                <th>State</th>
                {headers.map((h) => (
                  <th key={h} title={h}>
                    {h.length > 22 ? h.slice(0, 21) + "…" : h}
                  </th>
                ))}
                <th>Notes</th>
                <th className="num">Changes</th>
                <th className="num">Tickets</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {shownWide.map((w) => (
                <tr key={w.target.id} className={needsAttention(w.target) ? "rp-attn-row" : undefined}>
                  <td><b>{w.target.name}</b> <span className="muted small">{w.target.typeName}</span></td>
                  <td className="muted">{w.target.area ?? ""}</td>
                  <td>
                    {w.target.state === "audited" ? <Tone tone="good">audited</Tone> : w.target.state === "not_audited" ? <Tone tone="bad">not audited</Tone> : <Tone tone="none">pending</Tone>}
                  </td>
                  {headers.map((h) => (
                    <td key={h} className={cellClass(w.cells[h])}>{w.cells[h] ?? DASH}</td>
                  ))}
                  <td className="muted small" style={{ maxWidth: 220 }}>{w.notes}</td>
                  <td className="num">{w.target.proposals.length || ""}</td>
                  <td className="num">{w.target.tickets.length || ""}</td>
                  <td className="muted small">{w.target.finding?.recordedBy ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 6 }}>
            {DASH} not recorded · <b>*</b> proposed by this audit, awaiting approval or applied at finalize · <b>!</b> does not match what is on file
          </p>
        </div>
      ) : (
        <table className="table rp-table" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>Location</th>
              <th>Area</th>
              <th>Category</th>
              <th>Item</th>
              <th>Result</th>
              <th>Note</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {shownItems.map((x: ItemRow, i) => (
              <tr key={i}>
                <td><b>{x.location}</b></td>
                <td className="muted">{x.area}</td>
                <td className="muted">{x.category}</td>
                <td>{x.item}</td>
                <td><Tone tone={x.tone}>{x.result}</Tone></td>
                <td className="muted">{x.note}</td>
                <td className="muted small">{x.recordedBy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function cellClass(v: string | undefined): string | undefined {
  if (!v || v === DASH) return "rp-cell-none";
  if (/^(Not working|No|Occupied !|Vacant !)$/.test(v)) return "rp-cell-bad";
  if (/^(Working|Yes|Occupied|Vacant)$/.test(v)) return "rp-cell-good";
  return undefined;
}

/** Asks which formats; PDF is the browser's print for now, Excel is a stub
 *  until the real implementation picks a workbook library. */
function ExportDialog({ onClose, wideCsv, itemCsv, auditName }: { onClose: () => void; wideCsv: () => string; itemCsv: () => string; auditName: string }) {
  const [pdf, setPdf] = useState(false);
  const [xlsx, setXlsx] = useState(true);
  const [csv, setCsv] = useState(true);
  const [scope, setScope] = useState<"locations" | "items" | "both">("locations");
  return (
    <div className="card" style={{ position: "absolute", right: 0, top: "110%", width: 300, zIndex: 5, boxShadow: "var(--shadow)" }}>
      <div className="card-kicker"><span>Export</span></div>
      <div className="stack" style={{ gap: 6 }}>
        <label><input type="checkbox" checked={pdf} onChange={(e) => setPdf(e.target.checked)} /> PDF (print)</label>
        <label><input type="checkbox" checked={xlsx} onChange={(e) => setXlsx(e.target.checked)} /> Excel (.xlsx)</label>
        <label><input type="checkbox" checked={csv} onChange={(e) => setCsv(e.target.checked)} /> CSV</label>
        <div className="muted small" style={{ marginTop: 6 }}>Rows</div>
        <select className="select" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          <option value="locations">Per location (as filtered)</option>
          <option value="items">Per item (as filtered)</option>
          <option value="both">Both (two sheets / two files)</option>
        </select>
        <div className="row" style={{ gap: 6, marginTop: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-sm" onClick={onClose}>Cancel</button>
          {csv && (scope === "locations" || scope === "both") && <ExportButton name={`${auditName} - locations.csv`} build={wideCsv} label="CSV" />}
          {csv && (scope === "items" || scope === "both") && <ExportButton name={`${auditName} - items.csv`} build={itemCsv} label="CSV items" />}
          {pdf && <button type="button" className="btn btn-sm" onClick={() => window.print()}>PDF</button>}
          {xlsx && <button type="button" className="btn btn-sm" title="Stub - the real page writes a workbook" onClick={() => window.alert("Excel: stubbed in the prototype")}>Excel</button>}
        </div>
      </div>
    </div>
  );
}
