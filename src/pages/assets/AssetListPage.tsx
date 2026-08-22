import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { statusLabel } from "../../lib/locations";
import {
  COMMON_ASSET_STATUSES,
  METER_TYPE_OPTIONS,
  assetStatusBadgeClass,
  meterSummary,
} from "../../lib/assets";

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

  const { data } = db.useQuery({
    assets: { checkouts: { person: {} }, location: {} },
  });

  const assets = useMemo(
    () =>
      [...(data?.assets ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      ),
    [data],
  );

  const categories = useMemo(
    () =>
      [...new Set(assets.map((a) => a.category).filter((c): c is string => Boolean(c)))].sort(),
    [assets],
  );
  const statuses = useMemo(
    () =>
      [
        ...new Set([
          ...COMMON_ASSET_STATUSES,
          ...assets.map((a) => a.currentStatus).filter((s): s is string => Boolean(s)),
        ]),
      ],
    [assets],
  );

  // An asset is out while it has a checkout with no time_in.
  const openCheckoutOf = (a: (typeof assets)[number]) =>
    (a.checkouts ?? []).find((c) => !c.timeIn);

  const filtered = assets.filter((a) => {
    if (categoryFilter && a.category !== categoryFilter) return false;
    if (statusFilter && a.currentStatus !== statusFilter) return false;
    if (checkedOutOnly && !openCheckoutOf(a)) return false;
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
            <option key={s} value={s}>
              {statusLabel(s)}
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
          const open = openCheckoutOf(a);
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
                  {a.location && <> · {a.location.name}</>}
                  {a.reservationEnabled && (
                    <>
                      {" "}
                      <span className="badge badge-accent">Reservable</span>
                    </>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className={assetStatusBadgeClass(a.currentStatus)}>
                  {a.currentStatus ? statusLabel(a.currentStatus) : "No status"}
                </span>
                {a.checkoutable && (
                  <div className="muted small">
                    {open
                      ? `Out${open.person?.name ? ` — ${open.person.name}` : ""}`
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

  const save = async () => {
    await db.transact(
      db.tx.assets[id()].update({
        name: name.trim(),
        category: category.trim() || undefined,
        hasMeter,
        meterType: hasMeter ? meterType : undefined,
        checkoutable,
        reservationEnabled: false,
        currentStatus: "available",
      }),
    );
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
