import { useState, type ReactNode } from "react";
import { useQuery } from "@powersync/react";
import { useTranslation } from "react-i18next";
import { number, time } from "../../i18n";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { FUEL_STEPS, fleetGroup, holderName, vehicleFuelLevel, type FleetGroup } from "../../lib/fleet";
import {
  fleetItemMode,
  pickable,
  returnTarget,
  undoCheckinBlocked,
  undoCheckoutBlocked,
  unitKey,
  type FleetItemMode,
  type FleetVehicleConfig,
  type FleetVehicleResult,
  type UndoBlocked,
} from "../../lib/fleetItem";
import { completeItem, itemConfig, type InstanceItemRow } from "../../data/checklists";
import { useAsset } from "../../data/assets";
import {
  checkInFleetVehicle,
  checkOutFleetVehicle,
  recordStatusCheck,
  undoFleetCheckin,
  undoFleetCheckout,
  withdrawStatusCheck,
  type FleetVehicleRow,
} from "../../data/fleet";
import { FuelGauge } from "../home/fleetParts";
import { VehicleForm } from "./FleetForms";
import type { FleetItems } from "./useFleetItems";

// The Fleet Vehicle Item (ActiveChecklistPage.spec.md § Fleet Vehicle Item):
// take, check or return a Fleet Vehicle from inside a checklist, on the
// Fleet card's own board and tiles. Take and Return check out and in at
// once, and Status Check writes as it is recorded, so Edit undoes rather
// than merely reopens.

const RING: Record<FleetGroup, string> = {
  yours: "var(--accent)",
  available: "var(--good)",
  others: "var(--line)",
  out_of_service: "var(--bad)",
};

const hm = (at: string) => time(at, { hour: "numeric", minute: "2-digit" });

export function FleetVehicleItem({
  item,
  fleet,
  editable,
}: {
  item: InstanceItemRow;
  fleet: FleetItems;
  editable: boolean;
}) {
  const { t } = useTranslation("checklists");
  const current = useCurrent();
  const mode = fleetItemMode(itemConfig(item) as FleetVehicleConfig);
  const answer = fleet.answer(item);
  const actorId = current.user?.id ?? null;
  // A Status Check reopened by Edit starts from what it had recorded.
  const [draft, setDraft] = useState<FleetVehicleResult | null>(null);

  const vehicleOf = (assetId: string) => fleet.vehicles.find((v) => v.id === assetId);
  const say = (none: FleetVehicleResult) => completeItem(item.id, none, item.note, actorId);

  const body = (() => {
    if (answer) {
      return <Answered item={item} mode={mode} result={answer.result} fleet={fleet} editable={editable} onReopenStatus={setDraft} />;
    }
    if (!fleet.myContact && mode !== "status") {
      return (
        <>
          <div className="muted small" style={{ marginTop: 6 }}>{t("fleet.noContact")}</div>
          {mode === "take" && editable && (
            <NoVehicle onClick={() => say({ type: "fleet_vehicle", mode: "take", none: true })} />
          )}
        </>
      );
    }
    if (!editable) return null;

    const target = returnTarget(fleet.held);
    const targetVehicle = target ? vehicleOf(target.asset_id) : undefined;

    if (mode === "return") {
      if (!target || !targetVehicle) return null;
      return (
        <WideTile vehicle={targetVehicle}>
          <div className="muted small" style={{ marginTop: 6 }}>{t("fleet.youHave", { name: targetVehicle.name })}</div>
          <VehicleForm
            kind="checkin"
            vehicle={targetVehicle}
            submitLabel={t("fleet.checkIn")}
            onSubmit={(v) =>
              checkInFleetVehicle(
                targetVehicle,
                target.id,
                { odometer: v.odometer, fuelLevel: v.fuelLevel!, note: v.note },
                fleet.postReturn(targetVehicle),
                fleet.ctx,
                { itemId: item.id },
              )
            }
          />
        </WideTile>
      );
    }

    const statusForm = (v: FleetVehicleRow, onCancel?: () => void) => (
      <VehicleForm
        key={v.id}
        kind="status"
        vehicle={v}
        submitLabel={t("fleet.record")}
        initial={draft && "fuelLogId" in draft && draft.assetId === v.id ? draft : null}
        onSubmit={async (values) => {
          await recordStatusCheck(
            v,
            {
              odometer: values.odometer.value,
              correctionReason: values.odometer.correctionReason,
              fuelLevel: values.fuelLevel!,
              fill: values.fill,
            },
            fleet.ctx,
            item.id,
          );
          setDraft(null);
        }}
        onCancel={onCancel}
      />
    );

    if (mode === "status" && targetVehicle) {
      return <WideTile vehicle={targetVehicle}>{statusForm(targetVehicle)}</WideTile>;
    }

    return (
      <>
        <Board
          mode={mode}
          fleet={fleet}
          initial={mode === "status" && draft && "fuelLogId" in draft ? draft.assetId : null}
          renderOpen={(v, close) =>
            mode === "take" ? (
              <VehicleForm
                kind="checkout"
                vehicle={v}
                submitLabel={t("fleet.checkOutVehicle", { name: v.name })}
                onSubmit={(values) =>
                  checkOutFleetVehicle(
                    v,
                    { contactId: fleet.myContact!, name: current.user?.name ?? "" },
                    values.odometer,
                    fleet.ctx,
                    { itemId: item.id },
                  )
                }
                onCancel={close}
              />
            ) : (
              statusForm(v, close)
            )
          }
        />
        <NoVehicle onClick={() => say({ type: "fleet_vehicle", mode: mode as "take" | "status", none: true })} />
      </>
    );
  })();

  const done = answer != null;
  return (
    <div className={"card" + (done ? " card-done" : "")} data-testid="fleet-item" data-mode={mode}>
      {!done && (
        <>
          <div className="card-title">{item.label}</div>
          <div className="card-meta">{t("fleet.optional", { mode: t(`fleet.mode.${mode}`) })}</div>
        </>
      )}
      {body}
    </div>
  );
}

function NoVehicle({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation("checklists");
  return (
    <button type="button" className="btn btn-quiet" style={{ marginTop: 6 }} onClick={onClick}>
      {t("fleet.noVehicle")}
    </button>
  );
}

/** An answered item: its summary, the vehicle in hand, and Edit, which undoes. */
function Answered({
  item,
  mode,
  result,
  fleet,
  editable,
  onReopenStatus,
}: {
  item: InstanceItemRow;
  mode: FleetItemMode;
  result: FleetVehicleResult;
  fleet: FleetItems;
  editable: boolean;
  onReopenStatus: (result: FleetVehicleResult) => void;
}) {
  const { t } = useTranslation("checklists");
  const current = useCurrent();
  const actorId = current.user?.id ?? null;
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checkoutId = "checkoutId" in result ? result.checkoutId : "";
  const { data: checkoutRows } = useQuery<{ time_out: string; time_in: string | null }>(
    "SELECT time_out, time_in FROM asset_checkouts WHERE id = ?",
    [checkoutId],
  );
  const checkout = checkoutRows[0];
  const assetId = "assetId" in result ? result.assetId : null;
  const vehicle = assetId ? fleet.vehicles.find((v) => v.id === assetId) : undefined;
  const name = vehicle?.name ?? "";

  const summary = fleetSummary(t, mode, result, vehicle, checkout);

  // What Edit does, and whether it may (§ Edit undoes what the item did).
  type Undo =
    | { blocked: UndoBlocked }
    | { confirm: string; detail: string; run: () => Promise<void> }
    | { run: () => Promise<void> };
  const undo: Undo | null = (() => {
    if ("nothing" in result) return null;
    if ("none" in result) return { run: () => completeItem(item.id, null, item.note, null) };
    if ("fuelLogId" in result) {
      return {
        run: async () => {
          if (vehicle) await withdrawStatusCheck(vehicle, result, actorId, item.id);
          onReopenStatus(result);
        },
      };
    }
    if (!vehicle) return null;
    if (mode === "take") {
      const blocked = undoCheckoutBlocked({ checkoutId, checkoutOpen: !!checkout && !checkout.time_in, returnSaved: null });
      return blocked
        ? { blocked }
        : {
            confirm: t("fleet.undo.checkout", { name }),
            detail: t("fleet.undo.checkoutDetail", { name }),
            run: () => undoFleetCheckout(vehicle, checkoutId, actorId, item.id),
          };
    }
    const blocked = undoCheckinBlocked({ vehicleHasOpenCheckout: vehicle.checkout_id != null });
    return blocked
      ? { blocked }
      : {
          confirm: t("fleet.undo.checkin", { name }),
          detail: t("fleet.undo.checkinDetail", { name }),
          run: () => undoFleetCheckin(vehicle, checkoutId, actorId, item.id),
        };
  })();

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      setConfirming(false);
    } catch (e) {
      setError(t("fleet.error", { message: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e) }));
    }
  };

  const held = vehicle && fleet.held.some((h) => h.asset_id === vehicle.id);
  return (
    <>
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="card-title">{item.label}</div>
          <div className="card-meta">{summary}</div>
        </div>
        {editable && undo && !confirming && (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => ("run" in undo && !("confirm" in undo) ? void run(undo.run) : setConfirming(true))}
          >
            {t("fleet.edit")}
          </button>
        )}
      </div>
      {mode === "take" && vehicle && held && <WideTile vehicle={vehicle} />}
      {confirming && undo && (
        <div style={{ marginTop: 10 }}>
          <div className="muted small">
            {"blocked" in undo
              ? t(`fleet.undoBlocked.${undo.blocked}`, { name })
              : "detail" in undo
                ? undo.detail
                : null}
          </div>
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {"confirm" in undo && (
              <button type="button" className="btn btn-danger" onClick={() => void run(undo.run)}>
                {undo.confirm}
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
              {"blocked" in undo ? t("fleet.undo.ok") : t("fleet.undo.keep")}
            </button>
          </div>
        </div>
      )}
      {error && <div className="badge badge-bad" style={{ display: "block", marginTop: 8 }}>{error}</div>}
    </>
  );
}

/** The Fleet card's wide "yours" tile, holding whatever the item needs. */
export function WideTile({ vehicle: v, children }: { vehicle: FleetVehicleRow; children?: ReactNode }) {
  const { t } = useTranslation("checklists");
  const unit = t(`fleet.unit.${unitKey(v.meter_type)}`);
  return (
    <div
      data-testid="fleet-item-tile"
      data-vehicle={v.name}
      data-pickable="false"
      style={{
        border: `2px solid ${RING.yours}`,
        borderRadius: 8,
        padding: "10px 12px",
        background: "var(--accent-soft)",
        marginTop: 8,
      }}
    >
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 650, fontSize: "1.05rem" }}>{v.name}</div>
          <div className="muted small">
            {v.checkout_kept === 1
              ? t("fleet.tile.keptFromPrevious")
              : t("fleet.tile.withYou", { time: v.checked_out_at ? hm(v.checked_out_at) : "" })}
          </div>
        </div>
        <div style={{ width: 80, flexShrink: 0 }}>
          {v.has_meter === 1 && v.meter_reading != null && (
            <div className="muted small" style={{ textAlign: "right" }}>
              {t("fleet.tile.reading", { reading: number(v.meter_reading), unit })}
            </div>
          )}
          <FuelGauge level={vehicleFuelLevel(v)} />
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * The Fleet card's board: every Fleet Vehicle with its status, reading and
 * fuel, so each one's state is seen before choosing. A tile the mode can act
 * on widens across the board when tapped and holds the form.
 */
function Board({
  mode,
  fleet,
  initial,
  renderOpen,
}: {
  mode: FleetItemMode;
  fleet: FleetItems;
  initial: string | null;
  renderOpen: (v: FleetVehicleRow, close: () => void) => ReactNode;
}) {
  const { t } = useTranslation("checklists");
  const [selected, setSelected] = useState<string | null>(initial);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8, alignItems: "start" }}>
      {fleet.vehicles.map((v) => {
        const group = fleetGroup(v, fleet.myContact);
        const can = pickable(mode, group);
        const open = can && selected === v.id;
        const unit = t(`fleet.unit.${unitKey(v.meter_type)}`);
        return (
          <div
            key={v.id}
            data-testid="fleet-item-tile"
            data-vehicle={v.name}
            data-pickable={String(can)}
            style={{
              gridColumn: open ? "1 / -1" : undefined,
              border: `2px solid ${open ? RING.yours : RING[group]}`,
              borderRadius: 8,
              background: open ? "var(--accent-soft)" : "var(--panel)",
              opacity: can ? 1 : 0.55,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              disabled={!can}
              aria-expanded={can ? open : undefined}
              onClick={() => setSelected(open ? null : v.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                font: "inherit",
                color: "inherit",
                background: "none",
                border: "none",
                padding: "8px 10px",
                cursor: can ? "pointer" : "default",
              }}
            >
              <div className="spread">
                <div style={{ fontWeight: 650, fontSize: "0.92rem" }}>{v.name}</div>
                {can && !open && (
                  <span className="small" style={{ color: "var(--accent)" }}>
                    {t(mode === "take" ? "fleet.tile.take" : "fleet.tile.check")}
                  </span>
                )}
              </div>
              <div className="muted small">
                {group === "available" && t("fleet.tile.available")}
                {group === "yours" && t("fleet.tile.withYou", { time: v.checked_out_at ? hm(v.checked_out_at) : "" })}
                {group === "others" &&
                  t("fleet.tile.withPerson", { name: holderName(v.checkout_person_id, fleet.people, v.checked_out_to) })}
                {group === "out_of_service" && t("fleet.tile.outOfService")}
              </div>
              {v.has_meter === 1 && v.meter_reading != null && (
                <div className="muted small" style={{ margin: "4px 0" }}>
                  {t("fleet.tile.reading", { reading: number(v.meter_reading), unit })}
                </div>
              )}
              <div style={{ maxWidth: open ? 160 : undefined }}>
                <FuelGauge level={vehicleFuelLevel(v)} />
              </div>
            </button>
            {open && <div style={{ padding: "0 10px 10px" }}>{renderOpen(v, () => setSelected(null))}</div>}
          </div>
        );
      })}
    </div>
  );
}

type T = ReturnType<typeof useTranslation<"checklists">>["t"];

/** One line for an answered item: here, and on the completed checklist. */
function fleetSummary(
  t: T,
  mode: FleetItemMode,
  result: FleetVehicleResult,
  vehicle: { name: string; has_meter: number; meter_type: string | null } | undefined,
  checkout: { time_out: string; time_in: string | null } | undefined,
): string {
  const name = vehicle?.name ?? "";
  if ("none" in result) return t("fleet.noVehicle");
  if ("nothing" in result) return t("fleet.nothingToReturn");
  if ("fuelLogId" in result) {
    const parts = [
      result.odometer != null && vehicle?.has_meter === 1
        ? t("fleet.statusWithOdometer", {
            name,
            odometer: number(result.odometer),
            unit: t(`fleet.unit.${unitKey(vehicle.meter_type)}`),
            fuel: FUEL_STEPS[result.fuelLevel],
          })
        : t("fleet.status", { name, fuel: FUEL_STEPS[result.fuelLevel] }),
    ];
    if (result.fill) parts.push(t("fleet.statusFill", { gallons: number(result.fill.gallons) }));
    return parts.join(" · ");
  }
  if (mode === "take") return t("fleet.checkedOut", { name, time: checkout ? hm(checkout.time_out) : "" });
  return t("fleet.checkedIn", { name, time: checkout?.time_in ? hm(checkout.time_in) : "" });
}

/** A Fleet Vehicle Item's answer on a completed checklist. */
export function FleetResultSummary({ result }: { result: FleetVehicleResult }) {
  const { t } = useTranslation("checklists");
  const { asset } = useAsset("assetId" in result ? result.assetId : undefined);
  const { data: rows } = useQuery<{ time_out: string; time_in: string | null }>(
    "SELECT time_out, time_in FROM asset_checkouts WHERE id = ?",
    ["checkoutId" in result ? result.checkoutId : ""],
  );
  return <span>{fleetSummary(t, result.mode, result, asset ?? undefined, rows[0])}</span>;
}
