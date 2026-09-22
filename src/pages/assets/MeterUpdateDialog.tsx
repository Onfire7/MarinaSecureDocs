import { useState } from "react";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { formatNumber, meterUnit } from "../../lib/assets";
import { recordMeterReading, type AssetRow } from "../../data/assets";
import { useTicketStatuses } from "../../data/lookups";

// Assets — Meter Update Dialog (see docs/pages/meter-update-dialog.html).
// The direct edit path, gated by manage_assets — the Meter Reading checklist
// item captures the same AssetMeterReading unrestricted as part of normal
// checklist completion. Both feed the same inline maintenance-rule check.
export function MeterUpdateDialog({
  asset,
  onClose,
}: {
  asset: AssetRow;
  onClose: () => void;
}) {
  const current = useCurrent();
  const { statuses: ticketStatuses } = useTicketStatuses();
  const [value, setValue] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [saving, setSaving] = useState(false);

  const hasMeter = asset.has_meter === 1;
  const currentValue = asset.meter_reading ?? 0;
  const entered = value === "" ? null : Number(value);

  // Metered assets take an absolute reading; meterless ones accrue hours, so
  // the entry is a delta added to the running total.
  const newTotal =
    entered == null ? null : hasMeter ? entered : currentValue + entered;
  const isCorrection = hasMeter && entered != null && entered < currentValue;

  const save = async () => {
    if (newTotal == null) return;
    setSaving(true);
    // recordMeterReading re-reads the rules, the reading history and this
    // asset's tickets before deciding what is due, so the check runs against
    // the state at save time rather than at render time — a checklist that
    // logged a reading while this dialog was open must not be missed.
    const openStatus = ticketStatuses.find((st) => st.is_terminal === 0);
    await recordMeterReading(
      asset,
      newTotal,
      "manual",
      isCorrection ? correctionReason.trim() : null,
      openStatus?.id ?? null,
      current.user?.id ?? null,
    );
    onClose();
  };

  const unit = hasMeter ? meterUnit(asset.meter_type) : "hrs";

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Update meter — {asset.name}
        </div>

        <div className="field">
          <span className="field-label">
            {hasMeter ? "Current reading" : "Hours accrued so far"}
          </span>
          <div className="field-value">
            {formatNumber(currentValue)} {unit}
          </div>
        </div>

        <div className="field">
          <span className="field-label">
            {hasMeter ? `New reading (${unit}) — absolute value` : "Hours to add"}
          </span>
          <input
            type="number"
            className="input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
          />
          {!hasMeter && newTotal != null && (
            <p className="muted small" style={{ marginTop: 4 }}>
              New total: {formatNumber(newTotal)} {unit}
            </p>
          )}
        </div>

        {isCorrection && (
          <div className="field">
            <span className="badge badge-warn" style={{ marginBottom: 6 }}>
              Lower than the current reading
            </span>
            <span className="field-label">Reason — required</span>
            <textarea
              className="textarea"
              rows={2}
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              placeholder="e.g. meter replaced, previous entry corrected"
            />
          </div>
        )}

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={
              newTotal == null ||
              saving ||
              (isCorrection && !correctionReason.trim())
            }
            onClick={() => void save()}
          >
            Save
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
