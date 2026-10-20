// PROTOTYPE — throwaway. Variant B, "Grid": a spreadsheet you can inspect.
// Record by Location is ONE table across every Location, columns Expected /
// Found / Left / Time / Checklist, the Location named once per group and
// indented by depth; a segmented control flips "Exceptions" / "Everything".
// Incidents and tickets are two columns: as handed in, and since hand-in,
// the latter a compact what-changed list with the current state on top.
import { useState } from "react";
import { describeUpdate, fmtStamp, fmtTime, itemResult, type RecordItem, type ShiftReport, type Update } from "./fixture";
import { Photos } from "./shared";

function Since({ handedIn, updates }: { handedIn: string; updates: Update[] }) {
  const last = [...updates].reverse().find((u) => u.kind === "status");
  return (
    <div className="psb-since">
      <div className="report-kicker">Since hand-in</div>
      {updates.length === 0 ? (
        <div className="muted">No changes. Still {handedIn}.</div>
      ) : (
        <>
          <div className="psb-now">
            Now <strong>{last?.to ?? handedIn}</strong>
            {last && <span className="muted"> (was {handedIn})</span>}
          </div>
          <table className="psb-changes">
            <tbody>
              {updates.map((u, i) => (
                <tr key={i}>
                  <td className="muted small">{fmtStamp(u.at)}</td>
                  <td className="small">{u.by}</td>
                  <td>
                    <strong>{describeUpdate(u)}</strong>
                    {u.text && <div>{u.text}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

type Row = { loc: string; depth: number; first: boolean; i: RecordItem };

export const VariantB = {
  name: "Grid",
  Incidents: ({ r }: { r: ShiftReport }) => (
    <>
      <h2>Incidents ({r.incidents.length})</h2>
      {r.incidents.map((i) => (
        <div key={i.id} className="psb-pair">
          <div className="psb-orig">
            <div className="report-kicker">As handed in · {i.status}</div>
            <strong>{i.title}</strong>
            <div className="muted small">
              {i.type} · {i.location} · {fmtTime(i.at)}
            </div>
            {i.details.map((p, k) => (
              <p key={k}>{p}</p>
            ))}
            <Photos srcs={i.photos} />
          </div>
          <Since handedIn={i.status} updates={i.updates} />
        </div>
      ))}
    </>
  ),
  Tickets: ({ r }: { r: ShiftReport }) => (
    <>
      <h2>Tickets raised ({r.tickets.length})</h2>
      {r.tickets.map((t) => (
        <div key={t.id} className="psb-pair">
          <div className="psb-orig">
            <div className="report-kicker">
              As handed in · {t.status} · {t.priority}
            </div>
            <strong>{t.title}</strong>
            <div className="muted small">
              {t.location} · {fmtTime(t.at)} · from {t.from}
            </div>
            <p>{t.description}</p>
            <Photos srcs={t.photos} />
          </div>
          <Since handedIn={t.status} updates={t.updates} />
        </div>
      ))}
    </>
  ),
  Record: function RecordB({ r }: { r: ShiftReport }) {
    const [all, setAll] = useState(false);
    const groups = [
      ...r.locations.map((l) => ({ loc: l.name, depth: l.depth, items: l.items })),
      ...r.unlocated.map((u) => ({ loc: `${u.checklist} (no location)`, depth: 0, items: u.items })),
    ];
    const rows: Row[] = [];
    for (const g of groups) {
      const shown = all ? g.items : g.items.filter((i) => i.mark !== "ok");
      shown.forEach((i, k) => rows.push({ loc: g.loc, depth: g.depth, first: k === 0, i }));
    }
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    return (
      <>
        <div className="ps-record-head">
          <h2>Record by Location</h2>
          <div className="report-tabs">
            <button type="button" className={`report-tab ${!all ? "on" : ""}`} onClick={() => setAll(false)}>
              Exceptions ({total - groups.reduce((n, g) => n + g.items.filter((i) => i.mark === "ok").length, 0)})
            </button>
            <button type="button" className={`report-tab ${all ? "on" : ""}`} onClick={() => setAll(true)}>
              Everything ({total})
            </button>
          </div>
        </div>
        <div className="report-scroll">
          <table className="table report-table psb-grid">
            <thead>
              <tr>
                <th>Location</th>
                <th>Item</th>
                <th>Expected</th>
                <th>Result</th>
                <th>Time</th>
                <th>Checklist</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ loc, depth, first, i }) => (
                <tr key={i.id} className={`psb-${i.mark} ${first ? "psb-first" : ""}`}>
                  <td style={{ paddingLeft: 10 + depth * 16 }}>{first ? <strong>{loc}</strong> : ""}</td>
                  <td>
                    {i.kind === "checkin" ? <span className="psb-tag">Check-in</span> : null} {i.label}
                  </td>
                  <td>{i.expected ?? (i.kind === "checkin" ? "Visit" : "")}</td>
                  <td className={i.mark === "ok" ? "" : "report-cell-bad"}>{itemResult(i)}</td>
                  <td className="muted">{fmtTime(i.time) || "-"}</td>
                  <td className="muted small">{i.source}</td>
                  <td className="small">{i.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  },
};
