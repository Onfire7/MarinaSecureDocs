import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { compileShiftReport } from "../../lib/shiftReportDoc";
import type { ShiftReportDoc } from "../../lib/shiftReportDoc";
import { vehiclesToSettle } from "../../lib/endOfShift";
import { useEndOfShift } from "../../data/endOfShift";
import { useHeldVehicles } from "../../data/fleet";
import { endShiftWithReport, useShiftReportInputs } from "../../data/shiftReportData";
import { ShiftReportView } from "../reports/ShiftReportView";
import { ShiftReportEmailDialog } from "../reports/ShiftReportEmailDialog";
import { BeforeYouGo } from "./BeforeYouGo";

// The End of Shift review, /shift/end (ShiftReportPage.spec.md § The End of
// Shift review; ActiveChecklistPage.spec.md § Ending the shift). The report
// itself, compiled live, with the End of Shift Note to write and End Shift
// and Submit at its end: the only place a shift ends. Then the email dialog.
export function EndOfShiftPage() {
  const current = useCurrent();
  const navigate = useNavigate();
  const { t } = useTranslation("home");
  const userId = current.user?.id;
  const { shift } = useEndOfShift(userId);
  const { data: held } = useHeldVehicles(userId);
  const [note, setNote] = useState("");
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<ShiftReportDoc | null>(null);
  const inputs = useShiftReportInputs(shift, note);

  if (submitted) {
    return <ShiftReportEmailDialog doc={submitted} onClose={() => navigate("/")} />;
  }

  if (!shift) {
    return (
      <div className="placeholder">
        <div className="big">{t("endOfShift.notOnShift")}</div>
        <Link to="/">{t("endOfShift.backToDashboard")}</Link>
      </div>
    );
  }

  // A vehicle still held comes first, one at a time (§ Ending the shift).
  const unsettled = vehiclesToSettle(shift.started_at, held)[0];
  if (unsettled) return <BeforeYouGo key={unsettled.checkoutId} checkoutId={unsettled.checkoutId} />;

  if (!inputs) {
    return (
      <div className="placeholder">
        <div className="big">{t("endOfShift.loading")}</div>
      </div>
    );
  }
  const doc = compileShiftReport(inputs);

  const submit = async () => {
    if (!current.user) return;
    setEnding(true);
    setError(null);
    try {
      const stored = await endShiftWithReport(shift, doc, { id: current.user.id, name: current.user.name });
      setSubmitted(stored);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("endOfShift.couldntEnd"));
      setEnding(false);
    }
  };

  return (
    <div className="report-page">
      <ShiftReportView
        doc={doc}
        since={null}
        inApp
        banner={
          <div className="badge badge-warn" style={{ display: "block", marginBottom: 12 }} data-testid="report-banner">
            {t("endOfShift.reviewBanner")}
          </div>
        }
        afterHeader={
          <div className="field" style={{ maxWidth: 900 }}>
            <label className="field-label" htmlFor="end-of-shift-note">
              {t("endOfShift.noteLabel")}
            </label>
            <textarea
              id="end-of-shift-note"
              className="textarea"
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("endOfShift.notePlaceholder")}
            />
          </div>
        }
      />
      {error && (
        <div className="badge badge-bad" style={{ display: "block", margin: "0 20px 12px" }}>
          {error}
        </div>
      )}
      <div className="row report-noprint" style={{ padding: "0 20px 40px" }}>
        <button type="button" className="btn btn-primary" disabled={ending} onClick={() => void submit()}>
          {ending ? t("endOfShift.ending") : t("endOfShift.endShiftAndSubmit")}
        </button>
      </div>
    </div>
  );
}
