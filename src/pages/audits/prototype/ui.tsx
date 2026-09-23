// PROTOTYPE — throwaway. Small primitives the variants share: a KPI tile,
// the coverage bar, single-hue horizontal bars, and the export button.
// Layout is NOT shared - each variant owns its page structure.
import type { ReactNode } from "react";
import type { Summary } from "./reportModel";
import { downloadCsv } from "./reportModel";

export function Kpi({ label, value, sub, hero }: { label: string; value: string | number; sub?: string; hero?: boolean }) {
  return (
    <div className="rp-kpi">
      <div className="rp-kpi-label">{label}</div>
      <div className={hero ? "rp-hero" : "rp-kpi-value"}>{value}</div>
      {sub && <div className="rp-kpi-sub">{sub}</div>}
    </div>
  );
}

/** Part-to-whole with status meaning; labelled, never colour alone. */
export function CoverageBar({ s }: { s: Summary }) {
  const pct = (n: number) => (s.targets ? (n / s.targets) * 100 : 0);
  return (
    <div>
      <div className="rp-bar" role="img" aria-label={`${s.audited} audited, ${s.notAudited} not audited, ${s.pending} pending`}>
        {s.audited > 0 && <span className="rp-bar-good" style={{ width: `${pct(s.audited)}%` }} />}
        {s.notAudited > 0 && <span className="rp-bar-bad" style={{ width: `${pct(s.notAudited)}%` }} />}
        {s.pending > 0 && <span className="rp-bar-mute" style={{ width: `${pct(s.pending)}%` }} />}
      </div>
      <div className="rp-legend">
        <span><i className="rp-bar-good" /> Audited {s.audited}</span>
        <span><i className="rp-bar-bad" /> Not audited {s.notAudited}</span>
        {s.pending > 0 && <span><i className="rp-bar-mute" /> Pending {s.pending}</span>}
      </div>
    </div>
  );
}

/** One series, so one hue; the value sits at the tip. `bad` turns the fill to the danger token when the count means trouble. */
export function HBars({ rows, bad }: { rows: { label: string; value: number; of?: number }[]; bad?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => r.of ?? r.value));
  return (
    <div className="rp-hbars">
      {rows.map((r) => (
        <Row key={r.label} label={r.label} value={r.value} max={max} bad={!!bad && r.value > 0} />
      ))}
    </div>
  );
}
function Row({ label, value, max, bad }: { label: string; value: number; max: number; bad: boolean }) {
  return (
    <>
      <span>{label}</span>
      <div className="track">
        <div className={`fill ${bad ? "bad" : ""}`} style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="num">{value}</span>
    </>
  );
}

export function Tone({ tone, children }: { tone: "good" | "warn" | "bad" | "none"; children: ReactNode }) {
  const cls = tone === "none" ? "rp-tone-none" : `badge-${tone}`;
  return <span className={`badge ${cls}`}>{children}</span>;
}

export function ExportButton({ name, build, label = "Export CSV" }: { name: string; build: () => string; label?: string }) {
  return (
    <button type="button" className="btn btn-sm rp-noprint" onClick={() => downloadCsv(name, build())}>
      {label}
    </button>
  );
}
export function PrintButton() {
  return (
    <button type="button" className="btn btn-sm rp-noprint" onClick={() => window.print()}>
      Print / PDF
    </button>
  );
}
