import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { compareNames, statusLabel } from "../../lib/locations";
import {
  COMMON_ASSET_STATUSES,
  assetStatusBadgeClass,
  formatNumber,
  meterSummary,
  meterUnit,
} from "../../lib/assets";
import { displayName } from "../../lib/contacts";
import { TargetActivity } from "../shared/TargetActivity";
import { LocationPicker } from "../shared/LocationPicker";
import { activityTx } from "../../lib/activityLog";
import { CheckoutDialog } from "./CheckoutDialog";
import { MeterUpdateDialog } from "./MeterUpdateDialog";

// Assets — Asset Detail (see docs/pages/asset-detail.html).
// Status history, meter history, read-only maintenance rules (edited in
// Admin), and the checkout log for checkoutable assets.
export function AssetDetailPage() {
  const { id: assetId } = useParams();
  const current = useCurrent();
  const canManage = current.can("manage_assets");
  const [dialog, setDialog] = useState<"checkout" | "meter" | "status" | null>(null);

  const { data } = db.useQuery(
    assetId
      ? {
          assets: {
            $: { where: { id: assetId } },
            statusLog: { loggedBy: {} },
            meterReadings: { loggedBy: {} },
            checkouts: { person: {}, checkedOutBy: {} },
            reservations: { contact: {} },
            notes: { author: {} },
            incidents: {},
            tickets: {},
            location: {},
          },
          locations: {},
        }
      : null,
  );
  const asset = data?.assets?.[0];
  const locationOptions = [...(data?.locations ?? [])].sort((a, b) =>
    compareNames(a.name, b.name),
  );

  if (!asset) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const byNewest = <T extends { timestamp?: string | number; timeOut?: string | number }>(
    rows: T[],
    key: "timestamp" | "timeOut",
  ) =>
    [...rows].sort(
      (a, b) => new Date(b[key]!).getTime() - new Date(a[key]!).getTime(),
    );

  const statusLog = byNewest(asset.statusLog ?? [], "timestamp");
  const readings = byNewest(asset.meterReadings ?? [], "timestamp");
  const checkouts = byNewest(asset.checkouts ?? [], "timeOut");
  const openCheckout = checkouts.find((c) => !c.timeIn);
  const rules = asset.maintenanceRules ?? [];

  const now = Date.now();
  const upcoming = (asset.reservations ?? [])
    .filter(
      (r) =>
        r.status !== "cancelled" &&
        r.status !== "checked_out" &&
        r.expectedCheckin &&
        new Date(r.expectedCheckin).getTime() > now - 24 * 3600_000,
    )
    .sort(
      (a, b) =>
        new Date(a.expectedCheckin!).getTime() - new Date(b.expectedCheckin!).getTime(),
    )[0];

  const reassignLocation = (locationId: string) => {
    if (!locationId) return;
    const to = locationOptions.find((l) => l.id === locationId);
    void db.transact([
      db.tx.assets[asset.id].link({ location: locationId }),
      activityTx({
        eventType: "asset.location_changed",
        summary: `${asset.name} moved to ${to?.name ?? "another location"}`,
        subjectType: "assets",
        subjectId: asset.id,
        actorId: current.user?.id,
      }),
    ]);
  };
  const clearLocation = () => {
    if (!asset.location) return;
    const from = asset.location.name;
    void db.transact([
      db.tx.assets[asset.id].unlink({ location: asset.location.id }),
      activityTx({
        eventType: "asset.location_changed",
        summary: `${asset.name} removed from ${from}`,
        subjectType: "assets",
        subjectId: asset.id,
        actorId: current.user?.id,
      }),
    ]);
  };

  const meter = meterSummary(asset);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{asset.name}</h1>
          <div className="page-sub">
            {asset.category ?? "Uncategorized"}
            {meter && <> · {meter}</>}
          </div>
        </div>
        {canManage && (
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => setDialog("status")}>
              Log status
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setDialog("meter")}>
              Update meter
            </button>
            {asset.checkoutable && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => setDialog("checkout")}
              >
                {openCheckout ? "Return" : "Check out"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="stack">
          <div className="field">
            <span className="field-label">Current status</span>
            <div className="field-value row">
              <span className={assetStatusBadgeClass(asset.currentStatus)}>
                {asset.currentStatus ? statusLabel(asset.currentStatus) : "No status"}
              </span>
              {upcoming && (
                <span className="badge badge-warn">
                  Upcoming reservation{" "}
                  {new Date(upcoming.expectedCheckin!).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Location</span>
            <div className="field-value row">
              {asset.location ? (
                <Link to={`/locations/${asset.location.id}`}>{asset.location.name}</Link>
              ) : (
                <span className="muted">Unassigned</span>
              )}
              {canManage && (
                <>
                  <div style={{ minWidth: 240 }}>
                    <LocationPicker
                      locations={locationOptions}
                      value=""
                      onChange={reassignLocation}
                      allowNone={false}
                      placeholder="Assign a location…"
                    />
                  </div>
                  {asset.location && (
                    <button type="button" className="btn btn-sm btn-quiet" onClick={clearLocation}>
                      Unassign
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {asset.reservationEnabled && (
            <div className="field">
              <span className="field-label">Reservations</span>
              <div className="field-value small">
                Enabled ·{" "}
                {asset.reservationVisibility === "public"
                  ? "defaults to Billable"
                  : "defaults to Non-Billable"}
                {asset.postReturnStatus &&
                  ` · returns to ${statusLabel(asset.postReturnStatus)}`}{" "}
                <Link to="/reservations">View calendar</Link>
              </div>
            </div>
          )}

          <div>
            <div className="section-title">Maintenance rules</div>
            {rules.length === 0 ? (
              <span className="muted small">
                None configured — this asset never auto-generates tickets.
              </span>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {rules.map((r, i) => (
                  <div key={i} className="card small">
                    {r.label ??
                      (r.kind === "meter"
                        ? `Every ${formatNumber(r.every)} ${meterUnit(asset.meterType)}`
                        : `Every ${formatNumber(r.every)} days`)}
                    <span className="muted"> · {r.kind === "meter" ? "meter-based" : "time-based"}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="muted small" style={{ marginTop: 6 }}>
              Edited in Admin → Asset categories & maintenance rules.
            </p>
          </div>

          <div>
            <div className="section-title">Meter history</div>
            <div className="stack" style={{ gap: 6 }}>
              {readings.slice(0, 8).map((r) => (
                <div key={r.id} className="card spread">
                  <span>
                    {formatNumber(r.value)}
                    <span className="muted small">
                      {" "}
                      · {r.source === "checklist_item" ? "Checklist item" : "Manual"}
                      {r.correctionReason ? ` · correction: ${r.correctionReason}` : ""}
                    </span>
                  </span>
                  <span className="muted small">
                    {r.loggedBy?.name ? `${r.loggedBy.name} · ` : ""}
                    {new Date(r.timestamp).toLocaleDateString()}
                  </span>
                </div>
              ))}
              {readings.length === 0 && (
                <span className="muted small">No readings recorded.</span>
              )}
            </div>
          </div>

          <div>
            <div className="section-title">Status history</div>
            <div className="stack" style={{ gap: 6 }}>
              {statusLog.slice(0, 8).map((s) => (
                <div key={s.id} className="card spread">
                  <span>
                    <span className={assetStatusBadgeClass(s.status)}>
                      {statusLabel(s.status)}
                    </span>
                    {s.note && <span className="muted small"> · {s.note}</span>}
                  </span>
                  <span className="muted small">
                    {s.loggedBy?.name ? `${s.loggedBy.name} · ` : ""}
                    {new Date(s.timestamp).toLocaleDateString()}
                  </span>
                </div>
              ))}
              {statusLog.length === 0 && (
                <span className="muted small">No status entries yet.</span>
              )}
            </div>
          </div>

          {asset.checkoutable && (
            <div>
              <div className="section-title">Checkout log</div>
              <div className="stack" style={{ gap: 6 }}>
                {openCheckout && (
                  <div className="card card-done spread">
                    <span>
                      <strong>Currently out</strong>
                      {openCheckout.person && (
                        <span> — {displayName(openCheckout.person)}</span>
                      )}
                    </span>
                    <span className="muted small">
                      since {new Date(openCheckout.timeOut).toLocaleString()}
                    </span>
                  </div>
                )}
                {checkouts
                  .filter((c) => c.timeIn)
                  .slice(0, 6)
                  .map((c) => (
                    <div key={c.id} className="card spread">
                      <span>{c.person ? displayName(c.person) : "—"}</span>
                      <span className="muted small">
                        {new Date(c.timeOut).toLocaleDateString()} –{" "}
                        {new Date(c.timeIn!).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                {checkouts.length === 0 && (
                  <span className="muted small">Never checked out.</span>
                )}
              </div>
            </div>
          )}
        </div>

        <TargetActivity
          target={{ type: "asset", id: asset.id, label: asset.name }}
          notes={asset.notes ?? []}
          incidents={asset.incidents ?? []}
          tickets={asset.tickets ?? []}
        />
      </div>

      {dialog === "checkout" && (
        <CheckoutDialog
          asset={asset}
          openCheckout={openCheckout}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "meter" && (
        <MeterUpdateDialog asset={asset} onClose={() => setDialog(null)} />
      )}
      {dialog === "status" && (
        <StatusDialog asset={asset} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}

function StatusDialog({
  asset,
  onClose,
}: {
  asset: { id: string; name: string; currentStatus?: string | null };
  onClose: () => void;
}) {
  const current = useCurrent();
  const [status, setStatus] = useState(asset.currentStatus ?? "available");
  const [note, setNote] = useState("");

  const save = async () => {
    await db.transact([
      db.tx.assetStatusLogs[id()]
        .update({ status, timestamp: Date.now(), note: note.trim() || undefined })
        .link({
          asset: asset.id,
          ...(current.user ? { loggedBy: current.user.id } : {}),
        }),
      // currentStatus is the denormalized latest log value.
      db.tx.assets[asset.id].update({ currentStatus: status }),
      activityTx({
        eventType: "asset.status_changed",
        summary: `${asset.name} set to ${statusLabel(status)}${note.trim() ? ` — ${note.trim()}` : ""}`,
        subjectType: "assets",
        subjectId: asset.id,
        actorId: current.user?.id,
      }),
    ]);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Log status — {asset.name}
        </div>
        <div className="field">
          <span className="field-label">Status</span>
          <select
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[
              ...new Set([...COMMON_ASSET_STATUSES, asset.currentStatus ?? "available"]),
            ].map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Note (optional)</span>
          <textarea
            className="textarea"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            Log status
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
