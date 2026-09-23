import { useParams } from "react-router-dom";
import { fetchSharedReport } from "../../data/sharedReport";
import { ReportBody, useReport } from "./AuditReportView";

// The page a Share Link opens: /r/:key (AuditReportPage.spec.md). Public -
// App.tsx routes it before the signed-in app's chunk is requested, and
// nothing imported here reaches Clerk, PowerSync or the app's Supabase
// client. A missing, revoked or expired key is one neutral page.
export function SharedAuditReportPage() {
  const { key } = useParams();
  const loaded = useReport(fetchSharedReport, key);
  return (
    <div className="report-page">
      <div className="report-topbar report-noprint">
        <span className="report-brand">
          MarinaSecure <small>shared audit report</small>
        </span>
      </div>
      <ReportBody loaded={loaded} inApp={false} />
    </div>
  );
}
