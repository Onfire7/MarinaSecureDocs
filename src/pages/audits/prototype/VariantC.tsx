// PROTOTYPE — throwaway. Variant C: the walkthrough. One hero number, then
// the property in the order you'd walk it - grouped by area, one small card
// per location saying what was found. Built for a phone first; the table is
// a second view of the same rows, not the page.
import { useMemo, useState } from "react";
import type { AuditReport, ReportTarget } from "../../../data/auditReport";
import { attention, fmtDate, locationRows, narrative, needsAttention, statusWord, summarize, toCsv } from "./reportModel";
import { ExportButton, PrintButton, Tone } from "./ui";

export const name = "Walkthrough";

export function VariantC({ r }: { r: AuditReport }) {
  const s = useMemo(() => summarize(r), [r]);
  const sentences = useMemo(() => narrative(r, s), [r, s]);
  const [only, setOnly] = useState<"all" | "attention">("all");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [q, setQ] = useState("");
  const keep = (t: ReportTarget) =>
    (only === "all" || needsAttention(t)) && (!q || `${t.name} ${t.area ?? ""} ${attention(t).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  const areas = useMemo(() => {
    const m = new Map<string, ReportTarget[]>();
    for (const t of r.targets) (m.get(t.area ?? "Elsewhere") ?? m.set(t.area ?? "Elsewhere", []).get(t.area ?? "Elsewhere")!).push(t);
    return [...m.entries()];
  }, [r]);
  const rows = locationRows(r).filter((x) => keep(x.target));
  const csv = () =>
    toCsv(
      ["Location", "Area", "Type", "State", "Needs attention", "Changes", "Tickets", "Unanswered", "Recorded by", "Recorded at"],
      rows.map((x) => [x.location, x.area, x.type, x.state, x.attention, x.changes, x.tickets, x.unanswered, x.recordedBy, x.recordedAt]),
    );
  const attnCount = r.targets.filter(needsAttention).length;

  return (
    <div className="rp-walk">
      <div className="rp-heroband">
        <div className="muted small" style={{ textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 650 }}>
          {r.marinaName} · {s.kind === "occupancy" ? "Occupancy" : "Status"} audit · {statusWord(s.status)}
        </div>
        <div style={{ fontSize: "1.35rem", fontWeight: 720, marginTop: 4 }}>{r.audit.name}</div>
        <div className="row" style={{ gap: 28, alignItems: "flex-end", marginTop: 14, flexWrap: "wrap" }}>
          <div>
            <div className="rp-hero">{s.coveragePct}%</div>
            <div className="muted small">audited · {s.audited} of {s.targets}</div>
          </div>
          <div>
            <div style={{ fontSize: "1.5rem", fontWeight: 650 }}>{attnCount}</div>
            <div className="muted small">need attention</div>
          </div>
          <div>
            <div style={{ fontSize: "1.5rem", fontWeight: 650 }}>{s.proposals.total}</div>
            <div className="muted small">changes{s.proposals.undecided ? ` · ${s.proposals.undecided} undecided` : ""}</div>
          </div>
          <div>
            <div style={{ fontSize: "1.5rem", fontWeight: 650 }}>{s.tickets.open}</div>
            <div className="muted small">tickets open</div>
          </div>
        </div>
        <p style={{ margin: "14px 0 0", maxWidth: 640, opacity: 0.92 }}>{sentences.join(" ")}</p>
        <div className="muted small" style={{ marginTop: 8 }}>
          launched {fmtDate(r.audit.launched_at)}
          {r.audit.closed_at ? ` · closed ${fmtDate(r.audit.closed_at)}` : ""}
          {s.auditors.length ? ` · audited by ${s.auditors.join(", ")}` : ""}
        </div>
      </div>

      <div className="rp-sticky-actions rp-noprint">
        <div className="rp-filters" style={{ margin: 0 }}>
          <div className="rp-facets">
            <button type="button" className={`rp-facet ${only === "all" ? "on" : ""}`} onClick={() => setOnly("all")}>All · {r.targets.length}</button>
            <button type="button" className={`rp-facet ${only === "attention" ? "on" : ""}`} onClick={() => setOnly("attention")}>Needs attention · {attnCount}</button>
          </div>
          <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="rp-facets" style={{ marginLeft: "auto" }}>
            <button type="button" className={`rp-facet ${view === "cards" ? "on" : ""}`} onClick={() => setView("cards")}>Cards</button>
            <button type="button" className={`rp-facet ${view === "table" ? "on" : ""}`} onClick={() => setView("table")}>Table</button>
          </div>
          <ExportButton name={`${r.audit.name}.csv`} build={csv} />
          <PrintButton />
        </div>
      </div>

      {view === "cards" ? (
        areas.map(([area, list]) => {
          const shown = list.filter(keep);
          if (shown.length === 0) return null;
          const audited = list.filter((t) => t.state === "audited").length;
          const attn = list.filter(needsAttention).length;
          return (
            <section key={area} className="rp-area">
              <div className="rp-area-head">
                <h2>{area}</h2>
                <span className="muted small">
                  {audited} of {list.length} audited{attn ? ` · ${attn} need attention` : " · all fine"}
                </span>
              </div>
              <div className="rp-locs">
                {shown.map((t) => (
                  <LocCard key={t.id} t={t} />
                ))}
              </div>
            </section>
          );
        })
      ) : (
        <table className="table rp-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Location</th>
              <th>Area</th>
              <th>State</th>
              <th>Needs attention</th>
              <th className="num">Changes</th>
              <th className="num">Tickets</th>
              <th>Unanswered</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => (
              <tr key={x.target.id}>
                <td><b>{x.location}</b> <span className="muted small">{x.type}</span></td>
                <td className="muted">{x.area}</td>
                <td>{x.state}</td>
                <td style={{ color: x.attention ? "var(--bad)" : undefined }}>{x.attention || <span className="muted">-</span>}</td>
                <td className="num">{x.changes || ""}</td>
                <td className="num">{x.tickets || ""}</td>
                <td className="muted small">{x.unanswered}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.newLocationProposals.length > 0 && (
        <section className="rp-area">
          <div className="rp-area-head">
            <h2>Proposed new locations</h2>
          </div>
          <ul>
            {r.newLocationProposals.map((p) => (
              <li key={p.id}>
                {p.description} — <Tone tone={p.decision === "approved" ? "good" : p.decision === "rejected" ? "none" : "warn"}>{p.decision ?? "undecided"}</Tone>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function LocCard({ t }: { t: ReportTarget }) {
  const a = attention(t);
  const cls = t.state !== "audited" ? "skip" : a.length ? "attn" : "ok";
  return (
    <div className={`rp-loc ${cls}`}>
      <div className="name">
        <span>{t.name}</span>
        <span className="muted small" style={{ fontWeight: 500 }}>{t.typeName}</span>
      </div>
      {t.state === "not_audited" ? (
        <div className="muted">not audited{t.notAuditedReason ? ` · ${t.notAuditedReason}` : ""}</div>
      ) : t.state === "pending" ? (
        <div className="muted">not yet visited</div>
      ) : a.length ? (
        <ul>
          {a.map((x) => (
            <li key={x} className={/undecided|ticket open/.test(x) ? "warn" : "bad"}>{x}</li>
          ))}
        </ul>
      ) : (
        <div className="muted">
          all as expected
          {t.proposals.length ? ` · ${t.proposals.length} change${t.proposals.length === 1 ? "" : "s"} approved` : ""}
        </div>
      )}
      {t.gaps.length > 0 && <div className="muted small" style={{ marginTop: 4 }}>unanswered: {t.gaps.join(", ")}</div>}
    </div>
  );
}
