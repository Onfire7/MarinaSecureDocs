import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CSSProperties, ReactNode } from "react";
import { flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { DEFAULT_POST_RETURN_STATUS, formatNumber, meterUnit } from "../../lib/assets";
import {
  boardOrder,
  fleetGroup,
  holderName,
  readingChange,
  tripDistance,
  vehicleFuelLevel,
  type FleetGroup,
} from "../../lib/fleet";
import {
  checkInFleetVehicle,
  checkOutFleetVehicle,
  logFleetMileage,
  logFuel,
  useFleetPeople,
  useFleetVehicles,
  type FleetContext,
  type FleetVehicleRow,
} from "../../data/fleet";
import { resolveStatusByName, useAssetStatuses, useTicketStatuses } from "../../data/lookups";
import { FuelGauge } from "./fleetParts";
import { duration } from "../../i18n";

// Dashboard — the Fleet card (see FleetCard.spec.md).
// A board of the marina's own vehicles. Yours span the width with their
// actions showing; the rest sit two to a row and open a drawer when tapped.
// Checking out or in moves a tile between the two, animated with a view
// transition.

type DialogKind = "out" | "in" | "mileage" | "fuel";

const RING: Record<FleetGroup, string> = {
  yours: "var(--accent)",
  available: "var(--good)",
  others: "var(--line)",
  out_of_service: "var(--bad)",
};

export function FleetCard() {
  const { t } = useTranslation("home");
  const current = useCurrent();
  const navigate = useNavigate();
  const { data: rows } = useFleetVehicles();
  const { data: people } = useFleetPeople();
  const { statuses: ticketStatuses } = useTicketStatuses();
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: DialogKind; vehicleId: string } | null>(null);

  // Elapsed times on the tiles stay fresh.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const myContact = current.user?.contact_id ?? null;
  const vehicles = boardOrder(rows, myContact);
  const mine = vehicles.filter((v) => fleetGroup(v, myContact) === "yours");
  const rest = vehicles.filter((v) => fleetGroup(v, myContact) !== "yours");

  const ctx: FleetContext = {
    ticketStatusId: ticketStatuses.find((s) => s.is_terminal === 0)?.id ?? null,
    actorId: current.user?.id ?? null,
  };

  // A check-out or check-in moves a tile to a different parent, so it is
  // animated with a view transition: each tile carries a view-transition-name
  // and the browser morphs it from its old box to its new one. The write is
  // local, but the row reaches this component on the query's next emission,
  // so the transition's update waits until the vehicle has actually changed
  // group (or gives up after two seconds and shows whatever is there).
  const moved = useRef<{ id: string; from: FleetGroup; resolve: () => void } | null>(null);
  useLayoutEffect(() => {
    const waiting = moved.current;
    if (!waiting) return;
    const v = rows.find((r) => r.id === waiting.id);
    if (!v || fleetGroup(v, myContact) !== waiting.from) {
      moved.current = null;
      waiting.resolve();
    }
  });

  const closeAll = () => {
    setDialog(null);
    setSelected(null);
  };

  const morph = async (vehicle: FleetVehicleRow, write: () => Promise<unknown>) => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduced) {
      await write();
      closeAll();
      return;
    }
    // The card changes height, so the dashboard cards below it move too.
    // Name them for the duration, or the page cross-fades as one image and
    // leaves ghosts.
    const cards = [...document.querySelectorAll<HTMLElement>(".grid-cards > .card")];
    cards.forEach((c, i) => {
      c.style.viewTransitionName = `dash-card-${i}`;
      c.style.setProperty("view-transition-class", "morph");
    });
    const from = fleetGroup(vehicle, myContact);
    const transition = document.startViewTransition(async () => {
      const arrived = new Promise<void>((resolve) => {
        moved.current = { id: vehicle.id, from, resolve };
      });
      await write();
      flushSync(closeAll);
      await Promise.race([arrived, new Promise((r) => setTimeout(r, 2000))]);
      moved.current = null;
    });
    void transition.finished.finally(() =>
      cards.forEach((c) => {
        c.style.viewTransitionName = "";
        c.style.removeProperty("view-transition-class");
      }),
    );
    // A failed write rejects here, so the dialog stays open with its error.
    await transition.updateCallbackDone;
  };

  const open = (kind: DialogKind, v: FleetVehicleRow) => setDialog({ kind, vehicleId: v.id });
  const target = (v: FleetVehicleRow) => ({ target: { type: "asset" as const, id: v.id, label: v.name } });

  const actions = (v: FleetVehicleRow, group: FleetGroup) => ({
    primary:
      group === "yours" ? (
        <button type="button" className="btn btn-primary" onClick={() => open("in", v)}>
          {t("fleet.checkIn")}
        </button>
      ) : group === "available" ? (
        <button type="button" className="btn btn-primary" onClick={() => open("out", v)}>
          {t("fleet.checkOut")}
        </button>
      ) : null,
    secondary: [
      <button key="fuel" type="button" className="btn btn-sm" onClick={() => open("fuel", v)}>
        {t("fleet.fuel")}
      </button>,
      ...(v.has_meter === 1
        ? [
            <button key="mileage" type="button" className="btn btn-sm" onClick={() => open("mileage", v)}>
              {t("fleet.mileage")}
            </button>,
          ]
        : []),
      ...(current.can("create_incidents")
        ? [
            <button key="incident" type="button" className="btn btn-sm" onClick={() => navigate("/incidents/new", { state: target(v) })}>
              {t("fleet.incident")}
            </button>,
          ]
        : []),
      <button key="ticket" type="button" className="btn btn-sm" onClick={() => navigate("/tickets/new", { state: target(v) })}>
        {t("fleet.ticket")}
      </button>,
    ],
  });

  const meterText = (v: FleetVehicleRow) =>
    v.has_meter === 1 && v.meter_reading != null
      ? `${formatNumber(v.meter_reading)} ${meterUnit(v.meter_type)}`
      : null;

  const dialogVehicle = dialog ? rows.find((r) => r.id === dialog.vehicleId) ?? null : null;

  return (
    <div className="stack" style={{ gap: 8 }} data-testid="fleet-card">
      {mine.map((v) => {
        const a = actions(v, "yours");
        const trip = tripDistance(v, v.checkout_odometer_out);
        return (
          <div
            key={v.id}
            data-testid="fleet-tile"
            data-vehicle={v.name}
            data-group="yours"
            style={{
              ...transitionName(v),
              border: `2px solid ${RING.yours}`,
              borderRadius: 8,
              padding: "10px 12px",
              background: "var(--accent-soft)",
            }}
          >
            <div className="spread" style={{ alignItems: "flex-start" }}>
              <div>
                <div style={{ fontWeight: 650, fontSize: "1.05rem" }}>{v.name}</div>
                <div className="muted small">
                  {t("fleet.withYou", { since: since(v.checked_out_at) })}
                  {trip != null && ` · ${t("fleet.thisTrip", { distance: formatNumber(trip), unit: meterUnit(v.meter_type) })}`}
                </div>
              </div>
              <div style={{ width: 80, flexShrink: 0 }}>
                {meterText(v) && (
                  <div className="muted small" style={{ textAlign: "right" }}>
                    {meterText(v)}
                  </div>
                )}
                <FuelGauge level={vehicleFuelLevel(v)} />
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(${a.secondary.length}, 1fr)`,
                gap: 6,
                marginTop: 10,
              }}
            >
              {a.secondary}
            </div>
            <div style={{ display: "grid", marginTop: 6 }}>{a.primary}</div>
          </div>
        );
      })}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "start" }}>
        {rest.map((v) => {
          const group = fleetGroup(v, myContact);
          const disabled = group === "out_of_service";
          const isOpen = !disabled && v.id === selected;
          const a = actions(v, group);
          return (
            <div
              key={v.id}
              data-testid="fleet-tile"
              data-vehicle={v.name}
              data-group={group}
              style={{
                ...transitionName(v),
                border: `2px solid ${RING[group]}`,
                borderRadius: 8,
                background: isOpen ? "var(--accent-soft)" : "var(--panel)",
                opacity: !isOpen && group !== "available" ? 0.7 : 1,
                overflow: "hidden",
              }}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => setSelected(isOpen ? null : v.id)}
                aria-expanded={disabled ? undefined : isOpen}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  font: "inherit",
                  color: "inherit",
                  background: "none",
                  border: "none",
                  padding: "8px 10px",
                  cursor: disabled ? "default" : "pointer",
                }}
              >
                <div style={{ fontWeight: 650, fontSize: "0.92rem" }}>{v.name}</div>
                <div className="muted small">
                  {group === "available" && t("fleet.available")}
                  {group === "others" &&
                    t("fleet.withPerson", {
                      name: holderName(v.checkout_person_id, people, v.checked_out_to),
                      since: since(v.checked_out_at),
                    })}
                  {group === "out_of_service" && t("fleet.outOfService")}
                </div>
                {meterText(v) && (
                  <div className="muted small" style={{ margin: "4px 0" }}>
                    {meterText(v)}
                  </div>
                )}
                <FuelGauge level={vehicleFuelLevel(v)} />
              </button>
              {/* The drawer: animating grid rows 0fr → 1fr slides the tile's
                  bottom down to its natural height without measuring it. An
                  out-of-service tile has none. */}
              {!disabled && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateRows: isOpen ? "1fr" : "0fr",
                    transition: "grid-template-rows 200ms ease",
                  }}
                  inert={!isOpen}
                  aria-hidden={!isOpen}
                >
                  <div style={{ minHeight: 0, overflow: "hidden" }}>
                    <div style={{ padding: "0 10px 10px", display: "grid", gap: 6 }}>
                      {a.primary}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                        {a.secondary}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {dialog && dialogVehicle && (
        <FleetDialog
          kind={dialog.kind}
          vehicle={dialogVehicle}
          people={people.filter((p) => p.active === 1)}
          ctx={ctx}
          morph={morph}
          onClose={closeAll}
        />
      )}

      <style>{`
        /* Each moving box is clipped to its animating outline, and its
           contents are pinned top-left at natural size: a tile growing wide
           unrolls its new contents rather than stretching them, and the old
           picture fades out fast so text never doubles up. */
        ::view-transition-group(*) { animation-duration: 570ms; animation-timing-function: cubic-bezier(.2,.8,.2,1); }
        ::view-transition-group(*.morph) { overflow: hidden; border-radius: 8px; }
        ::view-transition-image-pair(*.morph) { position: absolute; inset: 0; }
        ::view-transition-old(*.morph), ::view-transition-new(*.morph) { height: auto; width: auto; inset: 0 auto auto 0; object-fit: none; }
        ::view-transition-old(*.morph) { animation-duration: 180ms; }
        ::view-transition-new(*.morph) { animation-duration: 300ms; animation-delay: 90ms; animation-fill-mode: both; }
        ::view-transition-old(root), ::view-transition-new(root) { animation: none; }
      `}</style>
    </div>
  );
}

function transitionName(v: { id: string }): CSSProperties {
  return {
    viewTransitionName: `fleet-${v.id.replace(/[^a-zA-Z0-9-]/g, "")}`,
    viewTransitionClass: "morph",
  } as CSSProperties;
}


function since(ts: string | null): string {
  return ts ? duration(Date.now() - new Date(ts).getTime()) : "";
}


// ---------------------------------------------------------------- dialogs

function FleetDialog({
  kind,
  vehicle,
  people,
  ctx,
  morph,
  onClose,
}: {
  kind: DialogKind;
  vehicle: FleetVehicleRow;
  people: { id: string; name: string; contact_id: string | null }[];
  ctx: FleetContext;
  morph: (v: FleetVehicleRow, write: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation(["home", "common"]);
  const current = useCurrent();
  const { statuses } = useAssetStatuses();
  const hasMeter = vehicle.has_meter === 1;
  const unit = meterUnit(vehicle.meter_type);
  const currentReading = vehicle.meter_reading;

  const [odometer, setOdometer] = useState(currentReading != null ? String(currentReading) : "");
  const [reason, setReason] = useState("");
  const [personContact, setPersonContact] = useState(() => {
    const me = current.user?.contact_id;
    return me && people.some((p) => p.contact_id === me) ? me : "";
  });
  const [fuel, setFuel] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [gallons, setGallons] = useState("");
  const [cost, setCost] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entered = hasMeter && odometer.trim() !== "" ? Number(odometer) : null;
  const change = hasMeter ? readingChange(currentReading, entered) : "none";
  const needsReason = change === "correction";
  const odometerEntry = { value: entered, correctionReason: needsReason ? reason : null };
  const trip =
    kind === "in" && entered != null && vehicle.checkout_odometer_out != null
      ? entered - vehicle.checkout_odometer_out
      : null;
  const gallonsValue = Number(gallons);
  const costValue = cost.trim() === "" ? null : Number(cost);

  const invalid =
    (hasMeter && odometer.trim() !== "" && Number.isNaN(entered)) ||
    (needsReason && !reason.trim()) ||
    (kind === "out" && !personContact) ||
    (kind === "in" && fuel == null) ||
    (kind === "mileage" && change === "none") ||
    (kind === "fuel" &&
      (!(gallonsValue > 0) || (costValue != null && (Number.isNaN(costValue) || costValue < 0))));

  const title = t(`fleet.dialog.${kind}`, { name: vehicle.name });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (kind === "out") {
        const person = people.find((p) => p.contact_id === personContact)!;
        await morph(vehicle, () =>
          checkOutFleetVehicle(vehicle, { contactId: personContact, name: person.name }, odometerEntry, ctx),
        );
      } else if (kind === "in") {
        // Where it lands on return: its own post-return status, else the
        // marina's "Available", else no status change — as Asset Detail does.
        const postReturn =
          statuses.find((s) => s.id === vehicle.post_return_status_id) ??
          resolveStatusByName(statuses, DEFAULT_POST_RETURN_STATUS);
        await morph(vehicle, () =>
          checkInFleetVehicle(
            vehicle,
            vehicle.checkout_id!,
            { odometer: odometerEntry, fuelLevel: fuel!, note: note.trim() || null },
            postReturn,
            ctx,
          ),
        );
      } else if (kind === "mileage") {
        await logFleetMileage(vehicle, odometerEntry, ctx);
        onClose();
      } else {
        await logFuel(vehicle, { gallons: gallonsValue, cost: costValue, odometer: odometerEntry }, ctx);
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-card"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-title" style={{ marginBottom: 10 }}>
          {title}
        </div>

        {kind === "out" && (
          <label className="field">
            <span className="field-label">{t("fleet.dialog.person")}</span>
            <select
              className="select"
              value={personContact}
              onChange={(e) => setPersonContact(e.target.value)}
            >
              <option value="">{t("fleet.dialog.selectPerson")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.contact_id!}>
                  {p.name}
                </option>
              ))}
            </select>
            {!current.user?.contact_id && (
              <span className="muted small">
                {t("fleet.dialog.notLinked")}
              </span>
            )}
          </label>
        )}

        {kind === "fuel" && (
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span className="field-label">{t("fleet.dialog.gallons")}</span>
              <input
                className="input"
                inputMode="decimal"
                value={gallons}
                onChange={(e) => setGallons(e.target.value)}
                autoFocus
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span className="field-label">{t("fleet.dialog.cost")}</span>
              <input
                className="input"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
              />
            </label>
          </div>
        )}

        {hasMeter && (
          <label className="field">
            <span className="field-label">
              {t(kind === "out" ? "fleet.dialog.odometerStart" : kind === "in" ? "fleet.dialog.odometerEnd" : "fleet.dialog.odometer", { unit })}
            </span>
            <input
              className="input"
              inputMode="decimal"
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              autoFocus={kind === "mileage"}
            />
            <span className="muted small" data-testid="fleet-trip">
              {trip != null && trip >= 0
                ? currentReading != null
                  ? t("fleet.dialog.lastRecordedTrip", { reading: formatNumber(currentReading), unit, distance: formatNumber(trip) })
                  : t("fleet.dialog.noReadingTrip", { unit, distance: formatNumber(trip) })
                : currentReading != null
                  ? t("fleet.dialog.lastRecorded", { reading: formatNumber(currentReading), unit })
                  : t("fleet.dialog.noReading")}
            </span>
          </label>
        )}

        {needsReason && (
          <label className="field">
            <span className="badge badge-warn" style={{ marginBottom: 6 }}>
              {t("fleet.dialog.lower")}
            </span>
            <span className="field-label">{t("fleet.dialog.reason")}</span>
            <textarea
              className="textarea"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("fleet.dialog.reasonPlaceholder")}
            />
          </label>
        )}

        {kind === "in" && (
          <>
            <div className="field">
              <span className="field-label">{t("fleet.dialog.fuelLevel")}</span>
              <FuelGauge level={fuel} onChange={setFuel} />
            </div>
            <label className="field">
              <span className="field-label">{t("fleet.dialog.report")}</span>
              <input
                className="input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t("fleet.dialog.reportPlaceholder")}
              />
            </label>
          </>
        )}

        {error && <Problem>{error}</Problem>}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t("common:cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={invalid || saving}
            onClick={() => void save()}
          >
            {kind === "out" ? t("fleet.checkOut") : kind === "in" ? t("fleet.checkIn") : t("common:save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Problem({ children }: { children: ReactNode }) {
  return (
    <p className="badge badge-bad" role="alert" style={{ whiteSpace: "normal" }}>
      {children}
    </p>
  );
}
