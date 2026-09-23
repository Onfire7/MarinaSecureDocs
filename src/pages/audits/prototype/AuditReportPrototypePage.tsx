// PROTOTYPE — throwaway. Three variants of the shareable audit report,
// switchable via ?variant= on /audits/:id/report-prototype. Question being
// answered: what does a report a manager sends to someone outside the app
// look like - what leads, how the executive summary reads, and what shape
// the results table takes (per location, or per item).
//
// Reads the real audit through the data layer; writes nothing. The public
// page will have no app shell, so this covers the shell with a fixed layer.
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuditReport } from "../../../data/auditReport";
import { PrototypeSwitcher } from "../../shared/PrototypeSwitcher";
import { VariantA, name as nameA } from "./VariantA";
import { VariantB, name as nameB } from "./VariantB";
import { VariantC, name as nameC } from "./VariantC";
import { VariantD, name as nameD } from "./VariantD";
import "./prototype.css";

const VARIANTS = [
  { key: "A", name: nameA },
  { key: "B", name: nameB },
  { key: "C", name: nameC },
  { key: "D", name: nameD },
];

export function AuditReportPrototypePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const variant = params.get("variant") ?? "D";
  const { report, isLoading } = useAuditReport(id);
  return (
    <div className="rp-layer">
      <div className="rp-topbar">
        <span className="rp-brand">
          MarinaSecure <small>shared audit report</small>
        </span>
        <span className="row" style={{ gap: 8 }}>
          <span className="badge badge-warn">PROTOTYPE · anyone with the link would see this</span>
          <Link to={`/audits/${id}`} className="btn btn-sm">
            Back to the audit
          </Link>
        </span>
      </div>
      {!report ? (
        <div className="placeholder">
          <div className="big">{isLoading ? "Assembling the report…" : "Audit not found"}</div>
        </div>
      ) : variant === "B" ? (
        <VariantB r={report} />
      ) : variant === "C" ? (
        <VariantC r={report} />
      ) : variant === "A" ? (
        <VariantA r={report} />
      ) : (
        <VariantD r={report} />
      )}
      <PrototypeSwitcher variants={VARIANTS} />
    </div>
  );
}
