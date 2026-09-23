// PROTOTYPE — throwaway. Variant A: the memo. A document that reads top to
// bottom like something you'd print and hand to an owner - letterhead,
// executive summary in sentences, the things that need attention, the
// changes, then the results table as an appendix with filters and export.
import { useMemo, useState } from "react";
import type { AuditReport, ReportTarget } from "../../../data/auditReport";
import { CATEGORY_LABEL } from "../../../lib/audits";
import { attention, fmtDate, fmtDateTime, locationRows, narrative, needsAttention, statusWord, summarize, toCsv } from "./reportModel";
import { CoverageBar, ExportButton, Kpi, PrintButton, Tone } from "./ui";

export const name = "Memo";

export function VariantA({ r }: { r: AuditReport }) {
  const s = useMemo(() => summarize(r), [r]);
  const sentences = useMemo(() => narrative(r, s), [r, s]);
  const rows = useMemo(() => locationRows(r), [r]);
  const [state, setState] = useState<"all" | "audited" | "not_audited" | "attention">("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const shown = rows.filter((row) => {
    if (state === "attention" && !needsAttention(row.target)) return false;
    if (state === "audited" && row.target.state !== "audited") return false;
    if (state === "not_audited" && row.target.state !== "not_audited") return false;
    if (q && !`${row.location} ${row.area} ${row.type} ${row.attention}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });
  const attn = r.targets.filter(needsAttention);
  const changes = [...r.targets.flatMap((t) => t.proposals.map((p) => ({ where: t.name, p }))), ...r.newLocationProposals.map((p) => ({ where: "(new)", p }))];
  const csv = () =>
    toCsv(
      ["Location", "Area", "Type", "State", "Needs attention", "Changes", "Tickets", "Unanswered", "Recorded by", "Recorded at"],
      shown.map((x) => [x.location, x.area, x.type, x.state, x.attention, x.changes, x.tickets, x.unanswered, x.recordedBy, x.recordedAt]),
    );

  return (
    <div className="rp-memo">
      <div className="rp-letterhead">
        <div>
          <div className="muted small" style={{ textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 650 }}>
            {r.marinaName} · {s.kind === "occupancy" ? "Occupancy" : "Status"} audit report
          </div>
          <h1>{r.audit.name}</h1>
          <div className="muted">
            {statusWord(s.status)} · launched {fmtDate(r.audit.launched_at)}
            {r.audit.closed_at ? ` · closed ${fmtDate(r.audit.closed_at)}` : ""}
            {r.audit.finalized_at ? ` · finalized ${fmtDate(r.audit.finalized_at)}` : ""}
          </div>
        </div>
        <div className="muted small" style={{ textAlign: "right" }}>
          {r.launchedBy && <div>Launched by {r.launchedBy}</div>}
          {s.auditors.length > 0 && <div>Audited by {s.auditors.join(", ")}</div>}
          <div>As of {fmtDateTime(r.asOf)}</div>
          <div className="row rp-noprint" style={{ gap: 6, justifyContent: "flex-end", marginTop: 8 }}>
            <PrintButton />
            <ExportButton name={`${r.audit.name}.csv`} build={csv} />
          </div>
        </div>
      </div>

      <h2>Executive summary</h2>
      {sentences.map((t, i) => (
        <p key={i} className={i === 0 ? "lede" : undefined}>
          {t}
        </p>
      ))}
      <div className="rp-kpis" style={{ marginTop: 14 }}>
        <Kpi label="Coverage" value={`${s.coveragePct}%`} sub={`${s.audited} of ${s.targets} locations`} />
        {s.kind === "status" ? (
          <Kpi label="Not working" value={s.broken.length} sub={s.broken.length ? "services, at audited locations" : "every service recorded works"} />
        ) : (
          <Kpi label="Unexpected" value={s.unexpected.length} sub="occupancy not matching the file" />
        )}
        <Kpi label="Changes" value={s.proposals.total} sub={`${s.proposals.approved} approved${s.proposals.undecided ? ` · ${s.proposals.undecided} undecided` : ""}`} />
        <Kpi label="Tickets" value={s.tickets.total} sub={`${s.tickets.open} open`} />
      </div>
      <div style={{ marginTop: 12 }}>
        <CoverageBar s={s} />
      </div>

      {attn.length > 0 && (
        <>
          <h2>Needs attention · {attn.length}</h2>
          <ul>
            {attn.map((t) => (
              <li key={t.id}>
                <b>{t.name}</b>
                {t.area ? <span className="muted"> ({t.area})</span> : null} — {attention(t).join("; ")}
              </li>
            ))}
          </ul>
        </>
      )}

      {s.gaps.length > 0 && (
        <>
          <h2>Still unanswered</h2>
          <p className="muted">
            On audited locations: {s.gaps.map((g) => `${g.label} (${g.count})`).join(", ")}. These are usually catalogue entries added after the location was visited.
          </p>
        </>
      )}

      {changes.length > 0 && (
        <>
          <h2>Changes proposed · {changes.length}</h2>
          <table className="table rp-table">
            <thead>
              <tr>
                <th>Location</th>
                <th>Change</th>
                <th>Decision</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {changes.map(({ where, p }) => (
                <tr key={p.id}>
                  <td>{where}</td>
                  <td>
                    {p.description}
                    {p.structural && <span className="badge badge-warn" style={{ marginLeft: 6 }}>structural</span>}
                  </td>
                  <td>
                    <Tone tone={p.decision === "approved" ? "good" : p.decision === "rejected" ? "none" : "warn"}>{p.decision ?? "undecided"}</Tone>
                  </td>
                  <td className="muted">{p.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Results by location · {shown.length}</h2>
      <div className="rp-filters rp-noprint">
        <select className="select" value={state} onChange={(e) => setState(e.target.value as typeof state)}>
          <option value="all">All locations</option>
          <option value="attention">Needs attention</option>
          <option value="audited">Audited</option>
          <option value="not_audited">Not audited</option>
        </select>
        <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="rp-count">{shown.length} of {rows.length}</span>
      </div>
      <table className="table rp-table">
        <thead>
          <tr>
            <th>Location</th>
            <th>Area</th>
            <th>State</th>
            <th>Findings</th>
            <th className="num">Changes</th>
            <th className="num">Tickets</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => (
            <RowA key={row.target.id} t={row.target} open={open === row.target.id} toggle={() => setOpen(open === row.target.id ? null : row.target.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowA({ t, open, toggle }: { t: ReportTarget; open: boolean; toggle: () => void }) {
  const a = attention(t);
  return (
    <>
      <tr onClick={toggle} style={{ cursor: "pointer" }}>
        <td>
          <b>{t.name}</b> <span className="muted small">{t.typeName}</span>
        </td>
        <td className="muted">{t.area ?? ""}</td>
        <td>
          {t.state === "audited" ? <Tone tone="good">audited</Tone> : t.state === "not_audited" ? <Tone tone="bad">not audited</Tone> : <Tone tone="none">pending</Tone>}
        </td>
        <td>
          {t.state === "not_audited" ? (
            <span className="muted">{t.notAuditedReason}</span>
          ) : a.length ? (
            <span style={{ color: "var(--bad)" }}>{a.join("; ")}</span>
          ) : t.finding ? (
            <span className="muted">all as expected</span>
          ) : null}
          {t.gaps.length > 0 && <span className="muted small"> · unanswered: {t.gaps.map((g) => CATEGORY_LABEL[g].toLowerCase()).join(", ")}</span>}
        </td>
        <td className="num">{t.proposals.length || ""}</td>
        <td className="num">{t.tickets.length || ""}</td>
      </tr>
      {open && t.finding && (
        <tr className="rp-row-expand">
          <td colSpan={6}>
            <dl className="rp-detail">
              {t.services.length > 0 && (
                <div>
                  <dt>Services</dt>
                  {t.services.map((s) => (
                    <dd key={s.name}>
                      {s.name}: {!s.present ? "absent" : s.working ? "working" : "not working"}
                      {s.note ? <span className="muted"> — {s.note}</span> : null}
                    </dd>
                  ))}
                </div>
              )}
              {t.amenities.length > 0 && (
                <div>
                  <dt>Amenities</dt>
                  {t.amenities.map((s) => (
                    <dd key={s.name}>
                      {s.name}: {s.present ? "present" : "absent"}
                      {s.note ? <span className="muted"> — {s.note}</span> : null}
                    </dd>
                  ))}
                </div>
              )}
              {t.answers.length > 0 && (
                <div>
                  <dt>Questions</dt>
                  {t.answers.map((s) => (
                    <dd key={s.prompt}>
                      {s.prompt} <b>{s.value === true ? "Yes" : s.value === false ? "No" : String(s.value ?? "-")}</b>
                    </dd>
                  ))}
                </div>
              )}
              <div>
                <dt>Recorded</dt>
                <dd>
                  {t.finding.recordedBy ?? "?"} · {fmtDateTime(t.finding.recordedAt)}
                </dd>
                {t.finding.clearlyMarked !== null && <dd>Clearly marked: {t.finding.clearlyMarked ? "yes" : "no"}</dd>}
                {t.finding.mappedCorrectly !== null && <dd>On the map: {t.finding.mappedCorrectly ? "correct" : "wrong"}</dd>}
                {t.finding.occupied !== null && <dd>Occupied: {t.finding.occupied ? "yes" : "no"}{t.finding.unexpectedOccupancy ? " (unexpected)" : ""}</dd>}
              </div>
              {(t.proposals.length > 0 || t.tickets.length > 0) && (
                <div>
                  <dt>Changes & tickets</dt>
                  {t.proposals.map((p) => (
                    <dd key={p.id}>
                      {p.description} — {p.decision ?? "undecided"}
                    </dd>
                  ))}
                  {t.tickets.map((k) => (
                    <dd key={k.id}>
                      Ticket: {k.title} — {k.status ?? (k.open ? "open" : "closed")}
                    </dd>
                  ))}
                </div>
              )}
            </dl>
          </td>
        </tr>
      )}
    </>
  );
}
