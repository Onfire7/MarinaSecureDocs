import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { number } from "../../i18n";
import { readingChange, tripDistance } from "../../lib/fleet";
import { unitKey } from "../../lib/fleetItem";
import type { OdometerEntry, FleetVehicleRow } from "../../data/fleet";
import { FuelGauge } from "../home/fleetParts";

// The forms a Fleet Vehicle Item opens inside a tile, and the End of Shift
// step reuses (ActiveChecklistPage.spec.md § Fleet Vehicle Item, § Ending
// the shift). The Fleet card's dialogs ask the same things; these sit inline.

export type VehicleFormKind = "checkout" | "checkin" | "status" | "keep";

export interface VehicleFormValues {
  odometer: OdometerEntry;
  fuelLevel: number | null;
  fill: { gallons: number; cost: number | null } | null;
  note: string | null;
}

export function VehicleForm({
  kind,
  vehicle,
  submitLabel,
  extra,
  canSubmit = true,
  initial,
  onSubmit,
  onCancel,
}: {
  kind: VehicleFormKind;
  vehicle: FleetVehicleRow;
  submitLabel: string;
  /** Fields of the caller's own, above these (Keep it's reason). */
  extra?: ReactNode;
  canSubmit?: boolean;
  /** A reopened Status Check starts from what it recorded. */
  initial?: { odometer: number | null; fuelLevel: number; fill?: { gallons: number; cost: number | null } } | null;
  onSubmit: (values: VehicleFormValues) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation("checklists");
  const hasMeter = vehicle.has_meter === 1;
  const unit = t(`fleet.unit.${unitKey(vehicle.meter_type)}`);
  const [odometer, setOdometer] = useState(
    initial?.odometer != null ? String(initial.odometer) : vehicle.meter_reading != null ? String(vehicle.meter_reading) : "",
  );
  const [reason, setReason] = useState("");
  const [fuel, setFuel] = useState<number | null>(initial?.fuelLevel ?? null);
  const [adding, setAdding] = useState(!!initial?.fill);
  const [gallons, setGallons] = useState(initial?.fill ? String(initial.fill.gallons) : "");
  const [cost, setCost] = useState(initial?.fill?.cost != null ? String(initial.fill.cost) : "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entered = odometer.trim() === "" ? null : Number(odometer);
  const change = hasMeter ? readingChange(vehicle.meter_reading, entered) : "none";
  const needsFuel = kind !== "checkout";
  const trip = kind === "checkin" && entered != null ? tripDistance({ ...vehicle, meter_reading: entered }, vehicle.checkout_odometer_out) : null;
  const ready =
    canSubmit &&
    !saving &&
    (!hasMeter || (entered != null && !Number.isNaN(entered))) &&
    (change !== "correction" || reason.trim() !== "") &&
    (!needsFuel || fuel != null) &&
    (!adding || Number(gallons) > 0);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        odometer: {
          value: hasMeter ? entered : null,
          correctionReason: change === "correction" ? reason.trim() : null,
        },
        fuelLevel: fuel,
        fill: adding && Number(gallons) > 0 ? { gallons: Number(gallons), cost: cost.trim() === "" ? null : Number(cost) } : null,
        note: note.trim() || null,
      });
    } catch (e) {
      setError(t("fleet.error", { message: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e) }));
      setSaving(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 8, marginTop: 8 }}>
      {extra}
      {hasMeter && (
        <label className="field">
          <span className="field-label">{t("fleet.odometer", { unit })}</span>
          <input
            className="input"
            inputMode="decimal"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
          />
        </label>
      )}
      {trip != null && trip >= 0 && (
        <div className="muted small">{t("fleet.thisTrip", { distance: number(trip), unit })}</div>
      )}
      {change === "correction" && (
        <label className="field">
          <span className="field-label">
            {t("fleet.belowCurrent", { reading: number(vehicle.meter_reading ?? 0) })}
          </span>
          <input
            className="input"
            aria-label={t("fleet.correctionReason")}
            placeholder={t("fleet.correctionReason")}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
      )}
      {needsFuel && (
        <div className="field">
          <span className="field-label">{t("fleet.fuelLevel")}</span>
          <FuelGauge level={fuel} onChange={setFuel} />
        </div>
      )}
      {kind === "status" &&
        (adding ? (
          <div className="stack" style={{ gap: 6, padding: 8, border: "1px solid var(--line)", borderRadius: 6 }}>
            <label className="field">
              <span className="field-label">{t("fleet.gallons")}</span>
              <input
                className="input"
                inputMode="decimal"
                value={gallons}
                onChange={(e) => {
                  setGallons(e.target.value);
                  if (Number(e.target.value) > 0) setFuel(4);
                }}
              />
            </label>
            <label className="field">
              <span className="field-label">{t("fleet.cost")}</span>
              <input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
            </label>
            <div className="muted small">{t("fleet.fillSetsFull")}</div>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => {
                setAdding(false);
                setGallons("");
                setCost("");
              }}
            >
              {t("fleet.removeFill")}
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => setAdding(true)}>
            {t("fleet.addFuel")}
          </button>
        ))}
      {kind === "checkin" && (
        <label className="field">
          <span className="field-label">{t("fleet.anythingToReport")}</span>
          <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}
      {error && <div className="badge badge-bad" style={{ display: "block" }}>{error}</div>}
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={!ready} onClick={() => void submit()}>
          {saving ? t("fleet.saving") : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={saving}>
            {t("fleet.cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
