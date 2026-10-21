// PROTOTYPE — throwaway. Variant D, the owner's combination (2026-10-20):
// incidents and tickets keep A's text layout - one column, the record as
// handed in, then the updates beneath it - dressed in B's styling: the
// "As handed in" kicker, and the updates on a filled "Since End of Shift" band
// that leads with the current state. Record by Location is C's board, with
// each card stating the first and last time anything was recorded there.
import { describeUpdate, fmtStamp, fmtTime, type Incident, type RecordItem, type ShiftReport, type Ticket, type Update } from "./fixture";
import { Photos } from "./shared";
import { VariantC } from "./VariantC";

function Since({ handedIn, updates }: { handedIn: string; updates: Update[] }) {
  const last = [...updates].reverse().find((u) => u.kind === "status");
  return (
    <div className="psd-since">
      <div className="report-kicker">
        Since End of Shift{updates.length > 0 ? ` · ${updates.length} update${updates.length === 1 ? "" : "s"}` : ""}
      </div>
      {updates.length === 0 ? (
        <div className="muted">No changes. Still {handedIn}.</div>
      ) : (
        <>
          <div className="psb-now">
            Now <strong>{last?.to ?? handedIn}</strong>
            {last && <span className="muted"> (was {handedIn})</span>}
          </div>
          <ol className="psd-thread">
            {updates.map((u, i) => (
              <li key={i}>
                <span className="muted small">
                  {fmtStamp(u.at)} · {u.by}
                </span>
                <div>
                  <strong>{describeUpdate(u)}</strong>
                  {u.text && <span>: {u.text}</span>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function IncidentD({ i }: { i: Incident }) {
  return (
    <article className="psd-doc" id={i.id}>
      <div className="psd-orig">
        <div className="report-kicker">At End of Shift · {i.status}</div>
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
    </article>
  );
}

function TicketD({ t }: { t: Ticket }) {
  return (
    <article className="psd-doc" id={t.id}>
      <div className="psd-orig">
        <div className="report-kicker">
          At End of Shift · {t.status} · {t.priority} · {t.assignee ?? "unassigned"}
        </div>
        <strong>{t.title}</strong>
        <div className="muted small">
          {t.location} · {fmtTime(t.at)} · from {t.from}
        </div>
        <p>{t.description}</p>
        <Photos srcs={t.photos} />
      </div>
      <Since handedIn={t.status} updates={t.updates} />
    </article>
  );
}

/** First and last time anything was recorded at a Location; one time when
 *  they are the same, nothing when nothing was. */
export function span(items: RecordItem[]): string {
  const times = items.map((i) => i.time).filter((t): t is string => !!t).sort();
  if (times.length === 0) return "";
  const a = fmtTime(times[0]);
  const b = fmtTime(times[times.length - 1]);
  return a === b ? a : `${a} – ${b}`;
}

export const VariantD = {
  name: "Combined",
  Incidents: ({ r }: { r: ShiftReport }) => (
    <>
      <h2>Incidents ({r.incidents.length})</h2>
      {r.incidents.map((i) => (
        <IncidentD key={i.id} i={i} />
      ))}
    </>
  ),
  Tickets: ({ r }: { r: ShiftReport }) => (
    <>
      <h2>Tickets raised ({r.tickets.length})</h2>
      {r.tickets.map((t) => (
        <TicketD key={t.id} t={t} />
      ))}
    </>
  ),
  Record: ({ r }: { r: ShiftReport }) => <VariantC.Record r={r} timeSpan={span} />,
};
