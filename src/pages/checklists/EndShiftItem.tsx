import { useState } from "react";
import { useTranslation } from "react-i18next";
import { time } from "../../i18n";
import type { InstanceItemRow } from "../../data/checklists";

// The End Shift Item (ActiveChecklistPage.spec.md § End Shift Item). Not one of
// the ItemProps components: tapping it submits the checklist it sits on, which
// only the panel can do, so the panel hands it that action.
export function EndShiftItem({
  item,
  onShift,
  othersRemaining,
  countOthersRemaining,
  busy,
  editable,
  onEndShift,
}: {
  item: InstanceItemRow;
  /** False when the person viewing has no active shift. */
  onShift: boolean;
  /** Unanswered items on this checklist other than this one, as rendered. */
  othersRemaining: number;
  /** The same count read at the moment of the tap, which the tap acts on. */
  countOthersRemaining: () => Promise<number>;
  busy: boolean;
  editable: boolean;
  onEndShift: () => void;
}) {
  // The same two-tap rule as Submit: unfinished work is submittable, never by
  // the tap that would submit a finished checklist.
  const [confirming, setConfirming] = useState(false);
  const { t } = useTranslation("checklists");

  if (item.completed_at != null) {
    return (
      <div className="card card-done" id="end-shift" data-testid="end-shift-item">
        <div className="card-title">{item.label}</div>
        <div className="card-meta">
          {t("endShift.submitted", {
            time: time(item.completed_at, { hour: "numeric", minute: "2-digit" }),
          })}
        </div>
      </div>
    );
  }
  if (!onShift) {
    return (
      <div className="card" id="end-shift" data-testid="end-shift-item">
        <div className="card-title">{item.label}</div>
        <div className="card-meta">{t("endShift.notOnShift")}</div>
      </div>
    );
  }
  return (
    <div className="card" id="end-shift" data-testid="end-shift-item">
      <div className="card-title">{item.label}</div>
      <div className="card-meta">
        {t("endShift.hint")}
      </div>
      {editable && (
        <div className="row" style={{ marginTop: 10, gap: 6, flexWrap: "wrap" }}>
          {confirming && othersRemaining > 0 ? (
            <>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={onEndShift}
              >
                {busy ? t("endShift.submitting") : t("endShift.submitAnyway", { count: othersRemaining })}
              </button>
              {!busy && (
                <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
                  {t("endShift.keepWorking")}
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={async () =>
                (await countOthersRemaining()) > 0 ? setConfirming(true) : onEndShift()
              }
            >
              {busy ? t("endShift.submitting") : t("endShift.endShift")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
