import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { compareNames } from "../../lib/locations";
import {
  METER_TYPE_OPTIONS,
  assetStatusBadgeClass,
  meterSummary,
} from "../../lib/assets";
import { createAsset, useAssets } from "../../data/assets";
import { useAssetStatuses } from "../../data/lookups";

// Assets — Asset List (see docs/pages/asset-list.html).
// Viewing is unrestricted, same as Tickets/Reservations/Boats; only creating
// (and the detail page's status/checkout/meter actions) need manage_assets.
export function AssetListPage() {
  const current = useCurrent();
  const canManage = current.can("manage_assets");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [checkedOutOnly, setCheckedOutOnly] = useState(false);
  const [adding, setAdding] = useState(false);

  // The open checkout comes back on the row: `checkout_id` is set only while a
  // checkout has no time_in, so "is it out" needs no second pass.
  const { data: assetsRaw } = useAssets();
  const { statuses } = useAssetStatuses();

  const assets = useMemo(
    () => [...assetsRaw].sort((a, b) => compareNames(a.name, b.name)),
    [assetsRaw],
  );

  const categories = useMemo(
    () =>
      [
        ...new Set(assets.map((a) => a.category).filter((c): c is string => Boolean(c))),
      ].sort(),
    [assets],
  );

  const filtered = assets.filter((a) => {
    if (categoryFilter && a.category !== categoryFilter) return false;
    if (statusFilter && a.status_id !== statusFilter) return false;
    if (checkedOutOnly && !a.checkout_id) return false;
    return true;
  });

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Assets</h1>
        {canManage && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => setAdding(true)}
          >
            + Add asset
          </button>
        )}
      </div>

      <div className="chip-row">
        <select
          className="select select-inline"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="select select-inline"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <label className="row" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={checkedOutOnly}
            onChange={(e) => setCheckedOutOnly(e.target.checked)}
          />
          <span className="small">Checked out only</span>
        </label>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        {filtered.map((a) => {
          const meter = meterSummary(a);
          return (
            <Link
              key={a.id}
              to={`/assets/${a.id}`}
              className="card spread"
              style={{ textDecoration: "none", color: "inherit", flexWrap: "wrap" }}
            >
              <div>
                <div className="card-title">{a.name}</div>
                <div className="card-meta">
                  {a.category ?? "Uncategorized"}
                  {meter && <> · {meter}</>}
                  {a.location_name && <> · {a.location_name}</>}
                  {a.reservation_enabled === 1 && (
                    <>
                      {" "}
                      <span className="badge badge-accent">Reservable</span>
                    </>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className={assetStatusBadgeClass(a.status_name)}>
                  {a.status_name ?? "No status"}
                </span>
                {a.checkoutable === 1 && (
                  <div className="muted small">
                    {a.checkout_id
                      ? `Out${a.checked_out_to ? ` — ${a.checked_out_to}` : ""}`
                      : "Available for checkout"}
                  </div>
                )}
              </div>
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <div className="placeholder">
            <div className="big">
              {assets.length === 0 ? "No assets tracked yet" : "No matches"}
            </div>
            {assets.length === 0 &&
              "Fixed infrastructure with no maintenance cycle or checkout isn't tracked here."}
          </div>
        )}
      </div>

      {adding && <AddAssetDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddAssetDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [hasMeter, setHasMeter] = useState(false);
  const [meterType, setMeterType] = useState("hours");
  const [checkoutable, setCheckoutable] = useState(false);

  // A new asset has no status log, and therefore no status. That is honest
  // rather than incomplete: the first status is set by whoever puts it into
  // service, and inventing an "Available" entry nobody logged would put a
  // fictitious event in the asset's history.
  const save = async () => {
    await createAsset({
      name: name.trim(),
      category: category.trim() || null,
      hasMeter,
      meterType: hasMeter ? meterType : null,
      checkoutable,
      reservationEnabled: false,
    });
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Add asset
        </div>
        <div className="field">
          <span className="field-label">Name — required</span>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="field">
          <span className="field-label">Category</span>
          <input
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Vehicles, Equipment"
          />
        </div>
        <div className="field">
          <label className="row" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={hasMeter}
              onChange={(e) => setHasMeter(e.target.checked)}
            />
            <span className="small">Has a meter</span>
          </label>
          {hasMeter ? (
            <select
              className="select select-inline"
              style={{ marginTop: 6 }}
              value={meterType}
              onChange={(e) => setMeterType(e.target.value)}
            >
              {METER_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <p className="muted small" style={{ marginTop: 4 }}>
              Meterless assets accrue hours instead of carrying a reading.
            </p>
          )}
        </div>
        <div className="field">
          <label className="row" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checkoutable}
              onChange={(e) => setCheckoutable(e.target.checked)}
            />
            <span className="small">Can be checked out</span>
          </label>
        </div>
        <p className="muted small">
          Maintenance rules and reservation settings are configured in Admin →
          Asset categories & maintenance rules.
        </p>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim()}
            onClick={() => void save()}
          >
            Add
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
