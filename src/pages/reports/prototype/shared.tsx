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
        <div>Handed in {fmtStamp(r.endedAt)}</div>
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
