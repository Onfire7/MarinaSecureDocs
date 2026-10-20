// PROTOTYPE — throwaway. Variant C, "Board": each Location is a card in a
// grid, its edge coloured by the worst thing in it and its header a strip of
// counts (check-ins visited of expected, exceptions, misses). Problems show
// open; the routine rest is behind the card's own "show n more". Incidents
// and tickets lead with a one-line "Updated since End of Shift: now Resolved"
// callout; the full timeline opens beneath it.
import { useState } from "react";
import { describeUpdate, fmtStamp, fmtTime, itemResult, type RecordItem, type ShiftReport, type Update } from "./fixture";
import { Photos } from "./shared";

function Callout({ handedIn, updates }: { handedIn: string; updates: Update[] }) {
  const [open, setOpen] = useState(false);
  if (updates.length === 0) return null;
  const last = [...updates].reverse().find((u) => u.kind === "status");
  return (
    <div className="psc-callout">
      <button type="button" className="psc-callout-head" onClick={() => setOpen(!open)}>
        <span>
          <strong>Updated since End of Shift</strong>
          {last ? ` · now ${last.to} (was ${handedIn})` : ""} · {updates.length} update{updates.length === 1 ? "" : "s"}, latest{" "}
          {fmtStamp(updates[updates.length - 1].at)}
        </span>
        <span>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <ul className="psc-timeline">
          {updates.map((u, i) => (
            <li key={i}>
              <span className="muted small">
                {fmtTime(u.at)} · {u.by}
              </span>{" "}
              <strong>{describeUpdate(u)}</strong>
              {u.text && <div>{u.text}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function worst(items: RecordItem[]) {
  if (items.some((i) => i.mark === "missed")) return "missed";
  if (items.some((i) => i.mark === "exception")) return "exception";
  return "ok";
}

function Card({ name, path, items, timeSpan }: { name: string; path?: string; items: RecordItem[]; timeSpan?: (items: RecordItem[]) => string }) {
  const [all, setAll] = useState(false);
  const checkins = items.filter((i) => i.kind === "checkin" && i.source !== "(not expected)");
  const visited = checkins.filter((i) => i.mark !== "missed").length;
  const exc = items.filter((i) => i.mark === "exception").length;
  const missed = items.filter((i) => i.mark === "missed").length;
  const problems = items.filter((i) => i.mark !== "ok");
  const shown = all ? items : problems;
  return (
    <section className={`psc-card psc-${worst(items)}`}>
      <div className="psc-card-head">
        <div>
          {path && <div className="muted small">{path}</div>}
          <strong>{name}</strong>
          {timeSpan && timeSpan(items) && <div className="muted small">{timeSpan(items)}</div>}
        </div>
        <div className="psc-counts small">
          {checkins.length > 0 && (
            <span>
              {visited}/{checkins.length} check-ins
            </span>
          )}
          {missed > 0 && <span className="psc-bad">{missed} missed</span>}
          {exc > 0 && <span className="psc-warn">{exc} exception{exc === 1 ? "" : "s"}</span>}
          {missed + exc === 0 && <span className="psc-good">all as expected</span>}
        </div>
      </div>
      {shown.length > 0 && (
        <ul className="psc-items">
          {shown.map((i) => (
            <li key={i.id} className={`psc-item-${i.mark}`}>
              <span>
                {i.kind === "checkin" ? "📍 " : ""}
                {i.label}
                <div className="muted small">
                  {i.source} {i.time ? `· ${fmtTime(i.time)}` : ""}
                  {i.note ? ` · ${i.note}` : ""}
                </div>
              </span>
              <span className="psc-result">{itemResult(i)}</span>
            </li>
          ))}
        </ul>
      )}
      {items.length > problems.length && (
        <button type="button" className="btn btn-sm psc-more" onClick={() => setAll(!all)}>
          {all ? "Show problems only" : `Show ${items.length - problems.length} more`}
        </button>
      )}
    </section>
  );
}

export const VariantC = {
  name: "Board",
  Incidents: ({ r }: { r: ShiftReport }) => (
    <>
      <h2>Incidents ({r.incidents.length})</h2>
      <div className="psc-docs">
        {r.incidents.map((i) => (
          <article key={i.id} className="card">
            <div className="spread">
              <strong>{i.title}</strong>
              <span className="badge">{i.status} at End of Shift</span>
            </div>
            <div className="muted small">
              {i.type} · {i.location} · {fmtTime(i.at)}
            </div>
            <Callout handedIn={i.status} updates={i.updates} />
            {i.details.map((p, k) => (
              <p key={k}>{p}</p>
            ))}
            <Photos srcs={i.photos} />
          </article>
        ))}
      </div>
    </>
  ),
  Tickets: ({ r }: { r: ShiftReport }) => (
    <>
      <h2>Tickets raised ({r.tickets.length})</h2>
      <div className="psc-docs">
        {r.tickets.map((t) => (
          <article key={t.id} className="card">
            <div className="spread">
              <strong>{t.title}</strong>
              <span className="badge">
                {t.priority} · {t.status} at End of Shift
              </span>
            </div>
            <div className="muted small">
              {t.location} · {fmtTime(t.at)} · from {t.from}
            </div>
            <Callout handedIn={t.status} updates={t.updates} />
            <p>{t.description}</p>
            <Photos srcs={t.photos} />
          </article>
        ))}
      </div>
    </>
  ),
  Record: ({ r, timeSpan }: { r: ShiftReport; timeSpan?: (items: RecordItem[]) => string }) => {
    let parent = "";
    return (
      <>
        <h2>Locations</h2>
        <div className="psc-board">
          {r.locations.map((l) => {
            if (l.depth === 0) parent = l.name;
            return <Card key={l.id} name={l.name} path={l.depth > 0 ? parent : undefined} items={l.items} timeSpan={timeSpan} />;
          })}
          {r.unlocated.map((u) => (
            <Card key={u.checklist} name={u.checklist} path="No location" items={u.items} timeSpan={timeSpan} />
          ))}
        </div>
      </>
    );
  },
};
