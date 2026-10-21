// PROTOTYPE — throwaway. The sections whose design is already settled and is
// the same in every variant: header, End of Shift Note, summary, Needs
// attention, Notes. The variants differ only below and between these.
import { fmtStamp, fmtTime, summarySentences, type ShiftReport } from "./fixture";

export function Letterhead({ r }: { r: ShiftReport }) {
  const mins = Math.round((new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()) / 60000);
  return (
    <div className="report-letterhead">
      <div>
        <div className="report-kicker">{r.marina} · Shift report</div>
        <h1>{r.guard}</h1>
        <div className="muted">
          {fmtStamp(r.startedAt)} – {fmtStamp(r.endedAt)} · {Math.floor(mins / 60)}h {mins % 60}m
        </div>
      </div>
      <div className="report-letterhead-right muted small">
        <div>Ended by {r.endedBy}</div>
        <div>End of Shift {fmtStamp(r.endedAt)}</div>
      </div>
    </div>
  );
}

export function EndOfShiftNote({ r }: { r: ShiftReport }) {
  return (
    <>
      <h2>End of Shift Note</h2>
      <blockquote className="ps-eos">{r.endOfShiftNote}</blockquote>
    </>
  );
}

export function Summary({ r }: { r: ShiftReport }) {
  return (
    <>
      <h2>Summary</h2>
      <div className="report-prose">
        {summarySentences(r).map((t, i) => (
          <p key={i} className={i === 0 ? "lede" : undefined}>
            {t}
          </p>
        ))}
      </div>
      <div className="ps-checklists">
        {r.checklists.map((c) => (
          <span key={c.name} className={`ps-chip ${c.done < c.total ? "ps-chip-bad" : ""}`}>
            {c.name} · {c.done}/{c.total}
            {c.completedAt ? ` · ${fmtTime(c.completedAt)}` : c.due ? ` · due ${fmtTime(c.due)}` : ""}
          </span>
        ))}
      </div>
    </>
  );
}

export function NeedsAttention({ r }: { r: ShiftReport }) {
  return (
    <>
      <h2>Needs attention ({r.attention.length})</h2>
      <ul className="ps-attn">
        {r.attention.map((a, i) => (
          <li key={i} className={`ps-attn-${a.tone}`}>
            <span className="ps-attn-where">{a.where}</span>
            <span>{a.text}</span>
            <span className="muted small">{fmtTime(a.at)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Vehicles: after Notes, before Locations (ShiftReportPage.spec.md § In the redesign). */
export function Vehicles({ r }: { r: ShiftReport }) {
  return (
    <>
      <h2>Vehicles ({r.vehicles.length})</h2>
      <div className="ps-vehicles">
        {r.vehicles.map((v) => {
          const span = v.out
            ? `${fmtTime(v.out)} – ${v.end?.kind === "in" ? fmtTime(v.end.at) : v.end?.kind === "kept" ? "kept past End of Shift" : "still out"}`
            : null;
          return (
            <div key={v.name} className="card ps-vehicle">
              <div className="spread" style={{ alignItems: "baseline" }}>
                <strong>{v.name}</strong>
                {span && <span className="muted small">{span}</span>}
              </div>
              {v.odometer && (
                <div className="small">
                  {v.odometer.out.toLocaleString()} → {v.odometer.end.toLocaleString()} (+{v.odometer.end - v.odometer.out} {v.odometer.unit})
                  {v.fuelBack && ` · fuel back ${v.fuelBack}`}
                </div>
              )}
              {v.fills.map((f) => (
                <div key={f.at} className="small muted">⛽ {f.gallons} gal at {fmtTime(f.at)}{f.cost != null && ` · ${f.cost.toFixed(2)}`}</div>
              ))}
              {v.statusChecks.map((c) => (
                <div key={c.at} className="small muted">{fmtTime(c.at)}: {c.odometer?.toLocaleString()} {v.odometer?.unit}, fuel {c.fuel}</div>
              ))}
              {v.readings.map((x) => (
                <div key={x.at} className="small muted">Mileage: {x.value.toLocaleString()} {x.unit} · {fmtTime(x.at)}</div>
              ))}
              {v.statuses.map((st) => (
                <div key={st.at} className="small">Status → {st.name} · {fmtTime(st.at)}{st.note && ` · “${st.note}”`}</div>
              ))}
              {v.note && <div className="small">“{v.note}”</div>}
              {v.keptReason && <div className="small">Kept: {v.keptReason}</div>}
              {v.raised.map((x) => (
                <div key={x.id} className="small"><a href={`#${x.id}`}>{x.kind === "incident" ? "Incident" : "Ticket"}: {x.title}</a></div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function Notes({ r }: { r: ShiftReport }) {
  return (
    <>
      <h2>Notes ({r.notes.length})</h2>
      <ul className="ps-notes">
        {r.notes.map((n, i) => (
          <li key={i}>
            <strong>{n.target}</strong> <span className="muted small">{fmtTime(n.at)}</span>
            <div>{n.text}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Photos({ srcs }: { srcs: string[] }) {
  if (srcs.length === 0) return null;
  return (
    <div className="ps-photos">
      {srcs.map((s, i) => (
        <a key={i} href={s} target="_blank" rel="noreferrer">
          <img src={s} alt="" />
        </a>
      ))}
    </div>
  );
}
