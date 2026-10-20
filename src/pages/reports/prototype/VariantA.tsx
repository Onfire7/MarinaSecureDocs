// PROTOTYPE — throwaway. Variant A, "Ledger": reads like the paper form.
// Record by Location is one continuous indented list, a row per item, with
// a mark in the margin; routine rows fold into one "n routine items" line per
// Location until "show all" is on. Updates follow each incident or ticket as
// a thread below a dashed "since hand-in" rule.
import { useState } from "react";
import { describeUpdate, fmtStamp, fmtTime, itemResult, type Incident, type RecordItem, type ShiftReport, type Ticket, type Update } from "./fixture";
import { Photos } from "./shared";

const GLYPH = { ok: "✓", missed: "✗", exception: "!" } as const;

function Thread({ updates }: { updates: Update[] }) {
  if (updates.length === 0) return <div className="psa-rule muted small">No updates since End of Shift</div>;
  return (
    <>
      <div className="psa-rule">Since End of Shift · {updates.length} update{updates.length === 1 ? "" : "s"}</div>
      <ol className="psa-thread">
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
  );
}

function IncidentA({ i }: { i: Incident }) {
  return (
    <article className="psa-doc">
      <div className="psa-doc-head">
        <strong>{i.title}</strong>
        <span className="muted small">
          {i.type} · {i.location} · {fmtTime(i.at)} · {i.status} at End of Shift
        </span>
      </div>
      {i.details.map((p, k) => (
        <p key={k}>{p}</p>
      ))}
      <Photos srcs={i.photos} />
      <Thread updates={i.updates} />
    </article>
  );
}

function TicketA({ t }: { t: Ticket }) {
  return (
    <article className="psa-doc">
      <div className="psa-doc-head">
        <strong>{t.title}</strong>
        <span className="muted small">
          {t.priority} · {t.location} · {fmtTime(t.at)} · from {t.from} · {t.status} at End of Shift
          {t.assignee ? `, ${t.assignee}` : ", unassigned"}
        </span>
      </div>
      <p>{t.description}</p>
      <Photos srcs={t.photos} />
      <Thread updates={t.updates} />
    </article>
  );
}

function Row({ i }: { i: RecordItem }) {
  return (
    <li className={`psa-row psa-${i.mark}`}>
      <span className="psa-glyph">{GLYPH[i.mark]}</span>
      <span className="psa-time">{fmtTime(i.time)}</span>
      <span>
        {i.kind === "checkin" ? "Check-in · " : ""}
        {i.label}
        {i.note && <span className="muted"> · {i.note}</span>}
      </span>
      <span className="psa-result">{itemResult(i)}</span>
      <span className="muted small psa-source">{i.source}</span>
    </li>
  );
}

function Block({ name, depth, items, all }: { name: string; depth: number; items: RecordItem[]; all: boolean }) {
  const shown = all ? items : items.filter((i) => i.mark !== "ok");
  const hidden = items.length - shown.length;
  return (
    <section className="psa-loc" style={{ marginLeft: depth * 22 }}>
      <div className="psa-loc-name">{name}</div>
      <ul>
        {shown.map((i) => (
          <Row key={i.id} i={i} />
        ))}
        {hidden > 0 && (
          <li className="psa-row psa-folded">
            <span className="psa-glyph">✓</span>
            <span />
            <span className="muted">
              {hidden} routine item{hidden === 1 ? "" : "s"}, all as expected
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}

export const VariantA = {
  name: "Ledger",
  Incidents: ({ r }: { r: ShiftReport }) => (
    <>
      <h2>Incidents ({r.incidents.length})</h2>
      {r.incidents.map((i) => (
        <IncidentA key={i.id} i={i} />
      ))}
    </>
  ),
  Tickets: ({ r }: { r: ShiftReport }) => (
    <>
      <h2>Tickets raised ({r.tickets.length})</h2>
      {r.tickets.map((t) => (
        <TicketA key={t.id} t={t} />
      ))}
    </>
  ),
  Record: function RecordA({ r }: { r: ShiftReport }) {
    const [all, setAll] = useState(false);
    return (
      <>
        <div className="ps-record-head">
          <h2>Locations</h2>
          <label className="small">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show all items
          </label>
        </div>
        {r.locations.map((l) => (
          <Block key={l.id} name={l.name} depth={l.depth} items={l.items} all={all} />
        ))}
        {r.unlocated.map((u) => (
          <Block key={u.checklist} name={`${u.checklist} (no location)`} depth={0} items={u.items} all={all} />
        ))}
      </>
    );
  },
};
