import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { DEFAULT_POST_RESERVATION_STATUS, statusLabel } from "../../lib/locations";
import {
  RESERVATION_STATUSES,
  reservationStatusBadgeClass,
  reservationTargetOf,
  type ReservationTarget,
} from "../../lib/reservations";

// Reservations — Reservation Detail (see docs/pages/reservation-detail.html).
// Fully viewable by anyone; every mutating action is manage_reservations.
// Billing fields exist only for Public-visibility targets — omitted from the
// layout entirely for Internal ones.
export function ReservationDetailPage() {
  const { id: reservationId } = useParams();
  const current = useCurrent();
  const canManage = current.can("manage_reservations");
  const [dialog, setDialog] = useState<"in" | "out" | null>(null);

  const { data } = db.useQuery(
    reservationId
      ? {
          reservations: {
            $: { where: { id: reservationId } },
            contact: {},
            location: { type: {} },
            asset: {},
          },
        }
      : null,
  );
  const reservation = data?.reservations?.[0];

  if (!reservation) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const target = reservationTargetOf(reservation);
  const isPublic = target?.isPublic ?? false;

  const update = (fields: Record<string, unknown>) => {
    void db.transact(db.tx.reservations[reservation.id].update(fields));
  };

  const setDates = (field: "expectedCheckin" | "expectedCheckout", value: string) => {
    update({ [field]: value ? new Date(value).getTime() : null });
  };

  const dateInputValue = (v: string | number | null | undefined) =>
    v ? new Date(v).toISOString().slice(0, 10) : "";

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {target?.name ?? "Reservation"}
            <span className="muted"> · {target?.typeLabel}</span>
          </h1>
          <div className="page-sub">
            {reservation.contact?.name ?? "No contact"}
            {current.can("view_contact") && reservation.contact?.phone
              ? ` · ${reservation.contact.phone}`
              : ""}
            {current.can("view_contact") && reservation.contact?.email
              ? ` · ${reservation.contact.email}`
              : ""}
          </div>
        </div>
        {canManage && (
          <div className="row">
            {reservation.status !== "checked_in" &&
              reservation.status !== "checked_out" &&
              reservation.status !== "cancelled" && (
                <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog("in")}>
                  Check in
                </button>
              )}
            {reservation.status === "checked_in" && (
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog("out")}>
                Check out
              </button>
            )}
            {reservation.status !== "cancelled" &&
              reservation.status !== "checked_out" && (
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => update({ status: "cancelled" })}
                >
                  Cancel reservation
                </button>
              )}
          </div>
        )}
      </div>

      <div className="grid-2">
        <div>
          <div className="field">
            <span className="field-label">Status</span>
            <div className="field-value row">
              <span className={reservationStatusBadgeClass(reservation.status)}>
                {statusLabel(reservation.status)}
              </span>
              {canManage && (
                <select
                  className="select select-inline"
                  value={reservation.status}
                  onChange={(e) => update({ status: e.target.value })}
                  title="Manual override — the check-in/out dialog is the normal path"
                >
                  {RESERVATION_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {target && (
            <div className="field">
              <span className="field-label">Target</span>
              <div className="field-value">
                <Link
                  to={
                    target.kind === "location"
                      ? `/locations/${target.id}`
                      : "/assets"
                  }
                >
                  {target.name}
                </Link>
              </div>
            </div>
          )}

          <div className="field">
            <span className="field-label">Expected check-in / check-out</span>
            {canManage ? (
              <div className="row">
                <input
                  type="date"
                  className="input select-inline"
                  value={dateInputValue(reservation.expectedCheckin)}
                  onChange={(e) => setDates("expectedCheckin", e.target.value)}
                />
                <input
                  type="date"
                  className="input select-inline"
                  value={dateInputValue(reservation.expectedCheckout)}
                  onChange={(e) => setDates("expectedCheckout", e.target.value)}
                />
              </div>
            ) : (
              <div className="field-value">
                {reservation.expectedCheckin
                  ? new Date(reservation.expectedCheckin).toLocaleDateString()
                  : "—"}{" "}
                –{" "}
                {reservation.expectedCheckout
                  ? new Date(reservation.expectedCheckout).toLocaleDateString()
                  : "—"}
              </div>
            )}
          </div>

          <div className="field">
            <span className="field-label">Actual check-in / check-out</span>
            <div className="field-value">
              {reservation.actualCheckin
                ? new Date(reservation.actualCheckin).toLocaleString()
                : "—"}{" "}
              /{" "}
              {reservation.actualCheckout
                ? new Date(reservation.actualCheckout).toLocaleString()
                : "—"}
            </div>
          </div>
        </div>

        {isPublic && (
          <div>
            <div className="section-title">Billing</div>
            {(["rate", "deposit", "balance"] as const).map((f) => (
              <div className="field" key={f}>
                <span className="field-label">{statusLabel(f)}</span>
                {canManage ? (
                  <input
                    type="number"
                    className="input select-inline"
                    value={reservation[f] ?? ""}
                    onChange={(e) =>
                      update({ [f]: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                ) : (
                  <div className="field-value">
                    {reservation[f] != null ? `$${reservation[f]}` : "—"}
                  </div>
                )}
              </div>
            ))}
            {reservation.earlyCheckin && (
              <div className="field">
                <span className="field-label">Early check-in</span>
                <div className="field-value">
                  {new Date(reservation.earlyCheckin).toLocaleString()}
                </div>
              </div>
            )}
            {reservation.lateCheckout && (
              <div className="field">
                <span className="field-label">Late check-out</span>
                <div className="field-value">
                  {new Date(reservation.lateCheckout).toLocaleString()}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {dialog && target && (
        <CheckInOutDialog
          mode={dialog}
          reservation={reservation}
          target={target}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

// Reservations — Check-In / Check-Out Dialog (see
// docs/pages/reservation-checkin-checkout.html). A deliberate dialog rather
// than an inline date edit: it also moves the target into whatever status
// the action implies — the one moment a reservation changes target status.
function CheckInOutDialog({
  mode,
  reservation,
  target,
  onClose,
}: {
  mode: "in" | "out";
  reservation: {
    id: string;
    expectedCheckin?: string | number | null;
    expectedCheckout?: string | number | null;
    contact?: { name?: string | null } | null;
  };
  target: ReservationTarget;
  onClose: () => void;
}) {
  const current = useCurrent();
  const [when, setWhen] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });

  const submit = async () => {
    const ts = new Date(when).getTime();
    const txns = [];

    if (mode === "in") {
      const early =
        target.isPublic &&
        reservation.expectedCheckin &&
        ts < new Date(reservation.expectedCheckin).getTime();
      txns.push(
        db.tx.reservations[reservation.id].update({
          actualCheckin: ts,
          status: "checked_in",
          ...(early ? { earlyCheckin: ts } : {}),
        }),
      );
      if (target.kind === "location") {
        txns.push(db.tx.locations[target.id].update({ status: "occupied" }));
      } else {
        txns.push(db.tx.assets[target.id].update({ currentStatus: "in_use" }));
        txns.push(
          db.tx.assetStatusLogs[id()]
            .update({ status: "in_use", timestamp: ts, note: "Reservation check-in" })
            .link({
              asset: target.id,
              ...(current.user ? { loggedBy: current.user.id } : {}),
            }),
        );
      }
    } else {
      const late =
        target.isPublic &&
        reservation.expectedCheckout &&
        ts > new Date(reservation.expectedCheckout).getTime();
      const postStatus =
        target.postStatus ??
        (target.kind === "location" ? DEFAULT_POST_RESERVATION_STATUS : "available");
      txns.push(
        db.tx.reservations[reservation.id].update({
          actualCheckout: ts,
          status: "checked_out",
          ...(late ? { lateCheckout: ts } : {}),
        }),
      );
      if (target.kind === "location") {
        txns.push(db.tx.locations[target.id].update({ status: postStatus }));
      } else {
        txns.push(db.tx.assets[target.id].update({ currentStatus: postStatus }));
        txns.push(
          db.tx.assetStatusLogs[id()]
            .update({ status: postStatus, timestamp: ts, note: "Reservation check-out" })
            .link({
              asset: target.id,
              ...(current.user ? { loggedBy: current.user.id } : {}),
            }),
        );
      }
    }

    await db.transact(txns);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          {mode === "in" ? "Check in" : "Check out"} — {target.name}
        </div>
        <p className="muted small">
          {reservation.contact?.name ?? "No contact"} · expected{" "}
          {reservation.expectedCheckin
            ? new Date(reservation.expectedCheckin).toLocaleDateString()
            : "—"}
          {" – "}
          {reservation.expectedCheckout
            ? new Date(reservation.expectedCheckout).toLocaleDateString()
            : "—"}
        </p>
        <div className="field">
          <span className="field-label">
            Actual {mode === "in" ? "check-in" : "check-out"} time (editable for backfill)
          </span>
          <input
            type="datetime-local"
            className="input"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>
        <p className="muted small">
          {mode === "in"
            ? `${target.name} will be marked ${target.kind === "location" ? "Occupied" : "In Use"}.`
            : `${target.name} will move to ${statusLabel(
                target.postStatus ??
                  (target.kind === "location"
                    ? DEFAULT_POST_RESERVATION_STATUS
                    : "available"),
              )}.`}
        </p>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => void submit()}>
            {mode === "in" ? "Check in" : "Check out"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
