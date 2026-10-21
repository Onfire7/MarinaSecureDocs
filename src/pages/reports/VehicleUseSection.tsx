import { useTranslation } from "react-i18next";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { compileVehicleUse, shiftWindowMs } from "../../lib/shiftReport";
import { useShiftVehicleRecords } from "../../data/fleet";
import { VehicleUseList } from "./VehicleUseList";

// The Shift Report's Vehicles section compiled live from the device
// (ShiftReportPage.spec.md § Vehicles): every use of a Fleet Vehicle by this
// guard in the Shift, however it was recorded. The stored report renders the
// same cards from its snapshot through VehicleUseList.
export function VehicleUseSection({
  shift,
}: {
  shift: { guard_id: string; started_at: string; ended_at: string | null };
}) {
  const { t } = useTranslation("reports");
  const current = useCurrent();
  const { contactId, checkouts, fuelLogs, statusLogs, readings, raised } = useShiftVehicleRecords(
    shift.guard_id,
    shift,
  );
  // Incident pointers follow the gate of the section they point to.
  const canSeeIncidents = current.can("view_incidents");
  const uses = compileVehicleUse({
    window: shiftWindowMs(shift),
    guardContactId: contactId,
    guardUserId: shift.guard_id,
    checkouts,
    fuelLogs,
    statusLogs,
    readings,
    raised: canSeeIncidents ? raised : raised.filter((r) => r.kind !== "incident"),
  });

  return (
    <div data-testid="shift-vehicles">
      <div className="section-title">{t("vehicles.title", { count: uses.length })}</div>
      <VehicleUseList uses={uses} />
    </div>
  );
}
