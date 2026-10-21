// PROTOTYPE — throwaway. Three layouts of the Shift Report on the page it will
// really live on - public, no shell - switchable with ?variant=A|B|C. Only
// how the Record by Location and the updates under incidents and tickets
// look differs; the rest is shared and settled. Fixture data, no database.
// Route: /r/shift-prototype (App.tsx, before the config check).
import { useSearchParams } from "react-router-dom";
import { PrototypeSwitcher } from "../../shared/PrototypeSwitcher";
import { report } from "./fixture";
import { EndOfShiftNote, Letterhead, NeedsAttention, Notes, Summary, Vehicles } from "./shared";
import { VariantA } from "./VariantA";
import { VariantB } from "./VariantB";
import { VariantC } from "./VariantC";
import { VariantD } from "./VariantD";
import "./prototype.css";

const VARIANTS = { A: VariantA, B: VariantB, C: VariantC, D: VariantD };

export function ShiftReportPrototypePage() {
  const [params] = useSearchParams();
  const key = (params.get("variant") ?? "A") as keyof typeof VARIANTS;
  const V = VARIANTS[key] ?? VariantA;
  const r = report;
  return (
    <div className="report-page">
      <div className="report-topbar">
        <span className="report-brand">
          MarinaSecure <small>shift report</small>
        </span>
      </div>
      <div className="report">
        <Letterhead r={r} />
        <EndOfShiftNote r={r} />
        <Summary r={r} />
        <NeedsAttention r={r} />
        <V.Incidents r={r} />
        <V.Tickets r={r} />
        <Notes r={r} />
        <Vehicles r={r} />
        <V.Record r={r} />
      </div>
      <PrototypeSwitcher variants={Object.entries(VARIANTS).map(([k, v]) => ({ key: k, name: v.name }))} />
    </div>
  );
}
