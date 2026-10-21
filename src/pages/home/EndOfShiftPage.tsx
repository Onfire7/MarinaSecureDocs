import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useTranslation } from "react-i18next";
import { dateTime } from "../../i18n";
import { shiftWindowMs } from "../../lib/shiftReport";
import { endShift } from "../../data/shifts";
import { useEndOfShift, useOpenShiftChecklists } from "../../data/endOfShift";
import { useHeldVehicles } from "../../data/fleet";
import { vehiclesToSettle } from "../../lib/endOfShift";
import { VehicleUseSection } from "../reports/VehicleUseSection";
import { BeforeYouGo } from "./BeforeYouGo";

// The End of Shift review, /shift/end (ActiveChecklistPage.spec.md § Ending
// the shift). The only place a shift ends. Until the Shift Report is built it
// is a plain confirmation: the shift, any of its checklists still open, and
// End Shift and Submit. The report will take this page's place, with the same
// button at its end.
export function EndOfShiftPage() {
  const current = useCurrent();
  const navigate = useNavigate();
  const userId = current.user?.id;
  const { shift } = useEndOfShift(userId);
  const open = useOpenShiftChecklists(userId, shift?.started_at);
  const { data: held } = useHeldVehicles(userId);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation("home");

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

  const submit = async () => {
    if (!current.user) return;
    setEnding(true);
    setError(null);
    try {
      await endShift(shift.id, { id: current.user.id, name: current.user.name });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("endOfShift.couldntEnd"));
      setEnding(false);
    }
  };

  const span = shiftWindowMs(shift);
  const minutes = Math.max(0, Math.round((span.end - span.start) / 60_000));
  const started = dateTime(shift.started_at, { weekday: "short", hour: "numeric", minute: "2-digit" });

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t("endOfShift.title")}</h1>
          <div className="page-sub">
            {minutes >= 60
              ? t("endOfShift.startedHours", { time: started, hours: Math.floor(minutes / 60), minutes: minutes % 60 })
              : t("endOfShift.startedMinutes", { time: started, minutes })}
          </div>
        </div>
      </div>

      {open.length > 0 && (
        <div className="card" data-testid="end-of-shift-open" style={{ marginBottom: 14 }}>
          <div className="card-title">
            {t("endOfShift.openChecklists", { count: open.length })}
          </div>
          <div className="card-meta" style={{ marginBottom: 8 }}>
            {t("endOfShift.openWarning", { count: open.length })}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {open.map((c) => (
              <Link key={c.id} to={`/checklists/${c.id}`}>
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <VehicleUseSection shift={shift} />
      </div>

      {error && (
        <div className="badge badge-bad" style={{ display: "block", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        disabled={ending}
        onClick={() => void submit()}
      >
        {ending ? t("endOfShift.ending") : t("endOfShift.endShiftAndSubmit")}
      </button>
    </div>
  );
}
