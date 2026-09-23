import { Link, useParams } from "react-router-dom";
import { fetchAuditReport } from "../../data/auditReport";
import { ReportBody, useReport } from "./AuditReportView";

// The Audit Report inside the app, for anyone who can see the audit
// (AuditReportPage.spec.md). Rows link to their findings.
export function AuditReportInAppPage() {
  const { id } = useParams();
  const loaded = useReport(fetchAuditReport, id);
  return (
    <div>
      <div className="page-sub report-noprint" style={{ marginBottom: 8 }}>
        <Link to={`/audits/${id}`}>← back to the audit</Link>
      </div>
      <ReportBody loaded={loaded} inApp />
    </div>
  );
}
