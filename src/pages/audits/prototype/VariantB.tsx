// PROTOTYPE — throwaway. Variant B: the dashboard. Numbers and charts on top,
// then the results as one row per item (location × service / amenity /
// question / change / ticket) with faceted filters - the "show me every
// place where Water is absent" shape. Export is the filtered rows.
import { useMemo, useState } from "react";
import type { AuditReport } from "../../../data/auditReport";
import { fmtDate, fmtDateTime, itemRows, narrative, statusWord, summarize, toCsv, type ItemRow } from "./reportModel";
import { CoverageBar, ExportButton, HBars, Kpi, PrintButton, Tone } from "./ui";

export const name = "Dashboard";

const CATEGORIES: ItemRow["category"][] = ["Service", "Amenity", "Question", "Marked", "Map", "Occupancy", "Change", "Ticket"];

export function VariantB({ r }: { r: AuditReport }) {
  const s = useMemo(() => summarize(r), [r]);
  const rows = useMemo(() => itemRows(r), [r]);
  const [cats, setCats] = useState<Set<ItemRow["category"]>>(new Set());
  const [attn, setAttn] = useState(false);
  const [type, setType] = useState("");
  const [area, setArea] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<keyof ItemRow>("location");
  const present = CATEGORIES.filter((c) => rows.some((x) => x.category === c));
  const types = [...new Set(rows.map((x) => x.type).filter(Boolean))];
  const areas = [...new Set(rows.map((x) => x.area).filter(Boolean))];
  const shown = rows
    .filter((x) => (cats.size === 0 || cats.has(x.category)) && (!attn || x.tone === "bad" || x.tone === "warn"))
    .filter((x) => (!type || x.type === type) && (!area || x.area === area))
    .filter((x) => !q || `${x.location} ${x.item} ${x.result} ${x.note}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => String(a[sort]).localeCompare(String(b[sort]), undefined, { numeric: true }));
  const toggleCat = (c: ItemRow["category"]) => {
    const n = new Set(cats);
    if (n.has(c)) n.delete(c);
    else n.add(c);
    setCats(n);
  };
  const csv = () =>
    toCsv(
      ["Location", "Area", "Type", "Category", "Item", "Result", "Note", "Recorded by"],
      shown.map((x) => [x.location, x.area, x.type, x.category, x.item, x.result, x.note, x.recordedBy]),
    );
  const th = (key: keyof ItemRow, label: string, cls = "") => (
    <th className={cls}>
      <button type="button" onClick={() => setSort(key)}>
        {label}
        {sort === key ? " ↓" : ""}
      </button>
    </th>
  );

  return (
    <div className="rp-dash">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="muted small">{r.marinaName} · {s.kind === "occupancy" ? "Occupancy" : "Status"} audit</div>
          <h1 className="page-title" style={{ fontSize: "1.5rem" }}>{r.audit.name}</h1>
          <div className="muted small">
            <Tone tone={s.status === "finalized" ? "good" : s.status === "closed" ? "warn" : "none"}>{statusWord(s.status)}</Tone>
            {" "}· launched {fmtDate(r.audit.launched_at)} · as of {fmtDateTime(r.asOf)}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <PrintButton />
          <ExportButton name={`${r.audit.name} - items.csv`} build={csv} />
        </div>
      </div>

      <div className="rp-kpis" style={{ marginTop: 14 }}>
        <Kpi label="Locations" value={s.targets} />
        <Kpi label="Audited" value={`${s.coveragePct}%`} sub={`${s.audited} of ${s.targets}`} />
        {s.kind === "status" ? <Kpi label="Not working" value={s.broken.length} sub="services" /> : <Kpi label="Unexpected" value={s.unexpected.length} sub="occupancy" />}
        <Kpi label="Changes" value={s.proposals.total} sub={`${s.proposals.approved} approved`} />
        <Kpi label="Undecided" value={s.proposals.undecided} sub="changes awaiting a decision" />
        <Kpi label="Tickets open" value={s.tickets.open} sub={`of ${s.tickets.total} raised`} />
      </div>

      <div className="rp-dash-grid">
        <div className="card">
          <div className="card-kicker"><span>Coverage</span></div>
          <CoverageBar s={s} />
          <p className="muted small" style={{ marginTop: 10, marginBottom: 0 }}>{narrative(r, s)[0]}</p>
        </div>
        {s.kind === "status" ? (
          <>
            <div className="card">
              <div className="card-kicker"><span>Services present · of {s.audited} audited</span></div>
              <HBars rows={s.services.map((x) => ({ label: x.name, value: x.present, of: s.audited }))} />
            </div>
            <div className="card">
              <div className="card-kicker"><span>Services not working</span></div>
              {s.broken.length ? (
                <HBars rows={s.services.filter((x) => x.broken).map((x) => ({ label: x.name, value: x.broken, of: s.audited }))} bad />
              ) : (
                <p className="muted small" style={{ margin: 0 }}>None. Every service recorded is working.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="card">
              <div className="card-kicker"><span>Occupancy found</span></div>
              <HBars rows={[{ label: "Occupied", value: s.occupied, of: s.audited }, { label: "Vacant", value: s.vacant, of: s.audited }]} />
            </div>
            <div className="card">
              <div className="card-kicker"><span>Does not match the file</span></div>
              {s.unexpected.length ? (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {s.unexpected.map((u) => (
                    <li key={u.location}>
                      <b>{u.location}</b> — {u.occupied ? "occupied, nothing on file" : "vacant, but leased or reserved"}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small" style={{ margin: 0 }}>Every audited location matched.</p>
              )}
            </div>
          </>
        )}
      </div>

      {s.questions.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="card-kicker"><span>Questions</span></div>
          <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
            {s.questions.map((qq) => (
              <div key={qq.prompt} style={{ minWidth: 220 }}>
                <div style={{ fontWeight: 600 }}>{qq.prompt}</div>
                {qq.kind === "yes_no" ? (
                  <HBars rows={[{ label: "Yes", value: qq.yes, of: qq.yes + qq.no }, { label: "No", value: qq.no, of: qq.yes + qq.no }]} />
                ) : (
                  <HBars rows={Object.entries(qq.tally).map(([k, v]) => ({ label: k, value: v, of: Object.values(qq.tally).reduce((a, b) => a + b, 0) }))} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="section-title">Results · {shown.length} items</div>
      <div className="rp-filters rp-noprint">
        <div className="rp-facets">
          {present.map((c) => (
            <button key={c} type="button" className={`rp-facet ${cats.has(c) ? "on" : ""}`} onClick={() => toggleCat(c)}>
              {c} · {rows.filter((x) => x.category === c).length}
            </button>
          ))}
        </div>
        <button type="button" className={`rp-facet ${attn ? "on" : ""}`} onClick={() => setAttn(!attn)}>
          Attention only
        </button>
        {types.length > 1 && (
          <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
        {areas.length > 1 && (
          <select className="select" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">All areas</option>
            {areas.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        )}
        <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="rp-count">{shown.length} of {rows.length}</span>
      </div>
      <table className="table rp-table">
        <thead>
          <tr>
            {th("location", "Location")}
            {th("area", "Area")}
            {th("category", "Category")}
            {th("item", "Item")}
            {th("result", "Result")}
            <th>Note</th>
            {th("recordedBy", "By")}
          </tr>
        </thead>
        <tbody>
          {shown.map((x, i) => (
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
    </div>
  );
}
