import { useState } from "react";
import { useTranslation } from "react-i18next";
import { checkInFleetVehicle, keepFleetVehicle } from "../../data/fleet";
import { VehicleForm } from "../checklists/FleetForms";
import { WideTile } from "../checklists/FleetVehicleItem";
import { useFleetItems } from "../checklists/useFleetItems";

// Vehicles still out, the step before the End of Shift review
// (src/pages/checklists/ActiveChecklistPage.spec.md § Ending the shift).
// Warned, never blocked: the guard checks the vehicle in, or keeps it and
// gives its readings either way.
export function BeforeYouGo({ checkoutId }: { checkoutId: string }) {
  const { t } = useTranslation("home");
  const { t: tc } = useTranslation("checklists");
  const fleet = useFleetItems();
  const [choice, setChoice] = useState<"in" | "keep" | null>(null);
  const [reason, setReason] = useState("");
  const vehicle = fleet.vehicles.find((v) => v.checkout_id === checkoutId);
  if (!vehicle) return null;

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t("endOfShift.beforeYouGo")}</h1>
          <div className="page-sub">{t("endOfShift.stillHave", { name: vehicle.name })}</div>
        </div>
      </div>
      <WideTile vehicle={vehicle}>
        {choice == null && (
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            <button type="button" className="btn btn-primary" onClick={() => setChoice("in")}>
              {t("endOfShift.checkItIn")}
            </button>
            <button type="button" className="btn" onClick={() => setChoice("keep")}>
              {t("endOfShift.keepIt")}
            </button>
          </div>
        )}
        {choice === "in" && (
          <VehicleForm
            kind="checkin"
            vehicle={vehicle}
            submitLabel={tc("fleet.checkIn")}
            onSubmit={(v) =>
              checkInFleetVehicle(
                vehicle,
                checkoutId,
                { odometer: v.odometer, fuelLevel: v.fuelLevel!, note: v.note },
                fleet.postReturn(vehicle),
                fleet.ctx,
              )
            }
            onCancel={() => setChoice(null)}
          />
        )}
        {choice === "keep" && (
          <VehicleForm
            kind="keep"
            vehicle={vehicle}
            submitLabel={t("endOfShift.keepAndContinue")}
            canSubmit={reason.trim() !== ""}
            extra={
              <label className="field">
                <span className="field-label">{t("endOfShift.whyKeep")}</span>
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            }
            onSubmit={(v) =>
              keepFleetVehicle(
                vehicle,
                checkoutId,
                { reason: reason.trim(), odometer: v.odometer, fuelLevel: v.fuelLevel! },
                fleet.ctx,
              )
            }
            onCancel={() => setChoice(null)}
          />
        )}
      </WideTile>
    </div>
  );
}
