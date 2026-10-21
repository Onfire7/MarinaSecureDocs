import { useTranslation } from "react-i18next";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { number, time } from "../../i18n";
import { FUEL_STEPS } from "../../lib/fleet";
import { compileVehicleUse, shiftWindowMs, type VehicleUse } from "../../lib/shiftReport";
import { useShiftVehicleRecords } from "../../data/fleet";

// The Shift Report's Vehicles section (ShiftReportPage.spec.md § Vehicles),
// also shown on the End of Shift review so the guard sees what the report
// will say. Every use of a Fleet Vehicle by this guard in the Shift, however
// it was recorded.
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
      <div className="stack" style={{ gap: 6 }}>
        {uses.length === 0 ? (
          <span className="muted small">{t("vehicles.none")}</span>
        ) : (
          uses.map((u) => <VehicleUseCard key={u.checkoutId ?? `asset-${u.assetId}`} use={u} />)
        )}
      </div>
    </div>
  );
}

const hm = (at: string) => time(at, { hour: "numeric", minute: "2-digit" });

function VehicleUseCard({ use: u }: { use: VehicleUse }) {
  const { t } = useTranslation("reports");
  const unit = u.meterType ? t(`vehicles.unit.${u.meterType as "mileage" | "hours" | "gallons"}`) : "";
  const span =
    u.end &&
    t("vehicles.span", {
      out: u.keptFromPrevious ? t("vehicles.keptFromPrevious") : hm(u.out!),
      end:
        u.end.kind === "in"
          ? hm(u.end.at!)
          : u.end.kind === "kept"
            ? t("vehicles.keptPast")
            : t("vehicles.stillOut"),
    });
  const fuel =
    u.fuelBack == null
      ? null
      : u.end?.kind === "kept"
        ? t("vehicles.fuelKept", { fuel: FUEL_STEPS[u.fuelBack] })
        : t("vehicles.fuelBack", { fuel: FUEL_STEPS[u.fuelBack] });

  return (
    <div className="card">
      <div className="spread" style={{ alignItems: "baseline", gap: 8 }}>
        <strong>{u.name}</strong>
        {span && <span className="muted small">{span}</span>}
      </div>
      {(u.distance != null || fuel) && (
        <div className="small">
          {u.distance != null &&
            u.odometerOut != null &&
            u.odometerEnd != null &&
            t("vehicles.odometer", {
              out: number(u.odometerOut),
              end: number(u.odometerEnd),
              distance: number(u.distance),
              unit,
            })}
          {u.distance != null && fuel && " · "}
          {fuel}
        </div>
      )}
      {u.fills.map((f) => (
        <div key={`fill-${f.at}`} className="small muted">
          {f.cost != null
            ? t("vehicles.fillCost", {
                gallons: number(f.gallons),
                time: hm(f.at),
                cost: number(f.cost, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
              })
            : t("vehicles.fill", { gallons: number(f.gallons), time: hm(f.at) })}
        </div>
      ))}
      {u.statusChecks.map((c) => (
        <div key={`check-${c.at}`} className="small muted">
          {c.odometer != null
            ? t("vehicles.statusCheck", { time: hm(c.at), odometer: number(c.odometer), unit, fuel: FUEL_STEPS[c.level] })
            : t("vehicles.statusCheckNoMeter", { time: hm(c.at), fuel: FUEL_STEPS[c.level] })}
        </div>
      ))}
      {u.readings.map((r) => (
        <div key={`reading-${r.at}`} className="small muted">
          {t("vehicles.reading", { value: number(r.value), unit, time: hm(r.at) })}
        </div>
      ))}
      {u.statuses.map((st) => (
        <div key={`status-${st.at}`} className="small">
          {st.note
            ? t("vehicles.statusNote", { status: st.name, time: hm(st.at), note: st.note })
            : t("vehicles.status", { status: st.name, time: hm(st.at) })}
        </div>
      ))}
      {u.note && <div className="small">{t("vehicles.note", { note: u.note })}</div>}
      {u.keptReason && <div className="small">{t("vehicles.kept", { reason: u.keptReason })}</div>}
      {u.raised.map((r) => (
        <div key={`${r.kind}-${r.id}`} className="small">
          {/* A pointer into this report's own Incidents or Tickets list, never a second copy. */}
          <a href={`#${r.kind}-${r.id}`}>
            {t(r.kind === "incident" ? "vehicles.incident" : "vehicles.ticket", { title: r.title })}
          </a>
        </div>
      ))}
    </div>
  );
}
