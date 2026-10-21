import { useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { compileShiftReport, updatesSince } from "../../lib/shiftReportDoc";
import { useShift } from "../../data/shifts";
import { useShiftReportInputs, useShiftReportSnapshot, useUpdatesSince } from "../../data/shiftReportData";
import { ShiftReportView } from "./ShiftReportView";
import { ShiftReportEmailDialog } from "./ShiftReportEmailDialog";

// Reports — Shift Report, in the app (see ShiftReportPage.spec.md § The
// in-app page). The snapshot once the shift has ended; compiled live from the
// device, with a banner, before. Email report opens the dialog; nothing
// here calls a send function.
export function ShiftReportPage() {
  const { id: shiftId } = useParams();
  const current = useCurrent();
  const { t } = useTranslation("reports");
  const [emailing, setEmailing] = useState(false);

  const { shift } = useShift(shiftId);
  const snapshot = useShiftReportSnapshot(shiftId);
  // The inputs are read whatever the state: hooks run every render, and a
  // supervisor's device holds the guard's rows within their sync windows.
  const inputs = useShiftReportInputs(snapshot ? null : shift);
  const since = useUpdatesSince(shift?.ended_at);

  if (!shift) {
    return (
      <div className="placeholder">
        <div className="big">{t("report.loading")}</div>
      </div>
    );
  }
  const isOwnShift = shift.guard_id === current.user?.id;
  if (!isOwnShift && !current.can("view_reports")) {
    return (
      <div className="placeholder">
        <div className="big">{t("report.nothingToSee")}</div>
      </div>
    );
  }

  const doc = snapshot ?? (inputs ? compileShiftReport(inputs) : null);
  if (!doc) {
    return (
      <div className="placeholder">
        <div className="big">{t("report.loading")}</div>
      </div>
    );
  }
  const banner = snapshot ? null : (
    <div className="badge badge-warn" style={{ display: "block", marginBottom: 12 }} data-testid="report-banner">
      {shift.ended_at ? t("report.noReport") : t("report.notEnded")}
    </div>
  );

  return (
    <div className="report-page">
      <div className="row report-noprint" style={{ justifyContent: "flex-end", padding: "8px 20px 0" }}>
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setEmailing(true)}>
          {t("report.emailReport")}
        </button>
      </div>
      <ShiftReportView doc={doc} since={snapshot ? updatesSince(doc, shift.ended_at, since) : null} inApp banner={banner} />
      {emailing && <ShiftReportEmailDialog doc={doc} onClose={() => setEmailing(false)} />}
    </div>
  );
}
