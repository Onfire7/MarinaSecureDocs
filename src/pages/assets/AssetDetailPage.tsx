import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { compareNames } from "../../lib/locations";
import {
  assetStatusBadgeClass,
  formatNumber,
  meterSummary,
  meterUnit,
} from "../../lib/assets";
import { TargetActivity } from "../shared/TargetActivity";
import { LocationPicker } from "../shared/LocationPicker";
import { CheckoutDialog } from "./CheckoutDialog";
import { MeterUpdateDialog } from "./MeterUpdateDialog";
import {
  moveAsset,
  setAssetStatus,
  useAsset,
  useAssetStatusLog,
  useCheckoutHistory,
  useMaintenanceRules,
  useMeterReadings,
  type AssetRow,
} from "../../data/assets";
import { useLocations } from "../../data/locations";
import { useReservationsForTarget } from "../../data/reservations";
import { useAssetStatuses } from "../../data/lookups";

// Assets — Asset Detail (see docs/pages/asset-detail.html).
// Status history, meter history, read-only maintenance rules (edited in
// Admin), and the checkout log for checkoutable assets.
export function AssetDetailPage() {
  const { id: assetId } = useParams();
  const current = useCurrent();
  const canManage = current.can("manage_assets");
  const [dialog, setDialog] = useState<"checkout" | "meter" | "status" | null>(null);

  const { asset } = useAsset(assetId);
  const { data: allLocations } = useLocations();
  const { data: statusLog } = useAssetStatusLog(assetId);
  const { data: readings } = useMeterReadings(assetId);
  const { data: checkouts } = useCheckoutHistory(assetId);
  const { data: rules } = useMaintenanceRules(assetId);
  const { data: reservations } = useReservationsForTarget("asset", assetId);
  const { statuses } = useAssetStatuses();

  const locationOptions = [...allLocations].sort((a, b) =>
    compareNames(a.name, b.name),
  );

  if (!asset) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  // Each list is already newest-first from its own query; the open checkout is
  // the one with no time_in.
  const openCheckout = checkouts.find((c) => !c.time_in);

  const now = Date.now();
  const upcoming = reservations
    .filter(
      (r) =>
        r.status !== "cancelled" &&
        r.status !== "checked_out" &&
        r.expected_checkin &&
        new Date(r.expected_checkin).getTime() > now - 24 * 3600_000,
    )
    .sort(
      (a, b) =>
        new Date(a.expected_checkin!).getTime() -
        new Date(b.expected_checkin!).getTime(),
    )[0];

  const actorId = current.user?.id ?? null;
  const assetLocation = asset.location_id
    ? { id: asset.location_id, name: asset.location_name ?? "its location" }
    : null;

  const reassignLocation = (locationId: string) => {
    if (!locationId) return;
    const to = locationOptions.find((l) => l.id === locationId);
    void moveAsset(asset, assetLocation, to ?? null, actorId);
  };
  const clearLocation = () => {
    if (!assetLocation) return;
    void moveAsset(asset, assetLocation, null, actorId);
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
            {asset.checkoutable === 1 && (
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
              <span className={assetStatusBadgeClass(asset.status_name)}>
                {asset.status_name ?? "No status"}
              </span>
              {upcoming && (
                <span className="badge badge-warn">
                  Upcoming reservation{" "}
                  {new Date(upcoming.expected_checkin!).toLocaleDateString(undefined, {
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
              {assetLocation ? (
                <Link to={`/locations/${assetLocation.id}`}>{assetLocation.name}</Link>
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
                  {assetLocation && (
                    <button type="button" className="btn btn-sm btn-quiet" onClick={clearLocation}>
                      Unassign
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {asset.reservation_enabled === 1 && (
            <div className="field">
              <span className="field-label">Reservations</span>
              <div className="field-value small">
                Enabled ·{" "}
                {asset.reservation_visibility === "public"
                  ? "defaults to Billable"
                  : "defaults to Non-Billable"}
                {asset.post_return_status_id &&
                  ` · returns to ${
                    statuses.find((st) => st.id === asset.post_return_status_id)?.name ??
                    "its post-return status"
                  }`}{" "}
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
                {rules.map((r) => (
                  <div key={r.id} className="card small">
                    {r.label ??
                      (r.kind === "meter"
                        ? `Every ${formatNumber(r.every)} ${meterUnit(asset.meter_type)}`
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
                      {r.correction_reason ? ` · correction: ${r.correction_reason}` : ""}
                    </span>
                  </span>
                  <span className="muted small">
                    {r.logged_by_name ? `${r.logged_by_name} · ` : ""}
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
                    <span className={assetStatusBadgeClass(s.status_name)}>
                      {s.status_name ?? "—"}
                    </span>
                    {s.note && <span className="muted small"> · {s.note}</span>}
                  </span>
                  <span className="muted small">
                    {s.logged_by_name ? `${s.logged_by_name} · ` : ""}
                    {new Date(s.timestamp).toLocaleDateString()}
                  </span>
                </div>
              ))}
              {statusLog.length === 0 && (
                <span className="muted small">No status entries yet.</span>
              )}
            </div>
          </div>

          {asset.checkoutable === 1 && (
            <div>
              <div className="section-title">Checkout log</div>
              <div className="stack" style={{ gap: 6 }}>
                {openCheckout && (
                  <div className="card card-done spread">
                    <span>
                      <strong>Currently out</strong>
                      {openCheckout.person_name && (
                        <span> — {openCheckout.person_name}</span>
                      )}
                    </span>
                    <span className="muted small">
                      since {new Date(openCheckout.time_out).toLocaleString()}
                    </span>
                  </div>
                )}
                {checkouts
                  .filter((c) => c.time_in)
                  .slice(0, 6)
                  .map((c) => (
                    <div key={c.id} className="card spread">
                      <span>{c.person_name ?? "—"}</span>
                      <span className="muted small">
                        {new Date(c.time_out).toLocaleDateString()} –{" "}
                        {new Date(c.time_in!).toLocaleDateString()}
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

        <TargetActivity target={{ type: "asset", id: asset.id, label: asset.name }} />
      </div>

      {dialog === "checkout" && (
        <CheckoutDialog
          asset={asset}
          openCheckout={openCheckout ?? null}
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

function StatusDialog({ asset, onClose }: { asset: AssetRow; onClose: () => void }) {
  const current = useCurrent();
  const { statuses } = useAssetStatuses();
  const [statusId, setStatusId] = useState(asset.status_id ?? "");
  const [note, setNote] = useState("");

  const save = async () => {
    const status = statuses.find((s) => s.id === statusId);
    if (!status) return;
    await setAssetStatus(
      asset,
      status,
      note.trim() || null,
      current.user?.id ?? null,
    );
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
            value={statusId}
            onChange={(e) => setStatusId(e.target.value)}
          >
            <option value="">Select…</option>
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {statuses.length === 0 && (
            <p className="muted small" style={{ marginTop: 4 }}>
              No asset statuses defined yet — add them in Admin → Assets.
            </p>
          )}
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
          <button
            type="button"
            className="btn btn-primary"
            disabled={!statusId}
            onClick={() => void save()}
          >
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
