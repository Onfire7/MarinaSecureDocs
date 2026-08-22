import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";

// Boats & Vehicles — Boat List / Vehicle List (see docs/pages/boat-list.html,
// docs/pages/vehicle-list.html). One nav section, two tabs. Record visibility
// is unrestricted; the owner column requires view_owner and is omitted
// entirely without it.
export function BoatListPage() {
  const current = useCurrent();
  const canEdit = current.can("edit_owner_contact");
  const canViewOwner = current.can("view_owner");
  const [tab, setTab] = useState<"boats" | "vehicles">("boats");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const { data } = db.useQuery({
    boats: { owners: {}, currentSlip: {} },
    vehicles: { owners: {}, currentLocation: {} },
  });

  const boats = useMemo(
    () =>
      [...(data?.boats ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      ),
    [data],
  );
  const vehicles = useMemo(
    () =>
      [...(data?.vehicles ?? [])].sort((a, b) =>
        a.description.localeCompare(b.description, undefined, { numeric: true }),
      ),
    [data],
  );

  const q = search.trim().toLowerCase();
  const matches = (...parts: (string | null | undefined)[]) =>
    !q || parts.some((p) => p?.toLowerCase().includes(q));

  const filteredBoats = boats.filter((b) =>
    matches(
      b.name,
      b.make,
      b.model,
      b.currentSlip?.name,
      ...(canViewOwner ? (b.owners ?? []).map((o) => o.name) : []),
    ),
  );
  const filteredVehicles = vehicles.filter((v) =>
    matches(
      v.description,
      v.plateNumber,
      v.currentLocation?.name,
      ...(canViewOwner ? (v.owners ?? []).map((o) => o.name) : []),
    ),
  );

  // First owner in succession order (ownerOrder ids, falling back to link order).
  const firstOwner = (
    owners: { id: string; name?: string | null }[] | undefined,
    order: string[] | undefined,
  ) => {
    const list = owners ?? [];
    if (!order || order.length === 0) return list[0];
    return list.find((o) => o.id === order[0]) ?? list[0];
  };

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Boats & Vehicles</h1>
        {canEdit && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
            + Add {tab === "boats" ? "boat" : "vehicle"}
          </button>
        )}
      </div>

      <div className="chip-row">
        <button
          type="button"
          className={"chip" + (tab === "boats" ? " active" : "")}
          onClick={() => setTab("boats")}
        >
          Boats ({boats.length})
        </button>
        <button
          type="button"
          className={"chip" + (tab === "vehicles" ? " active" : "")}
          onClick={() => setTab("vehicles")}
        >
          Vehicles ({vehicles.length})
        </button>
        <input
          className="input select-inline"
          style={{ marginLeft: "auto", minWidth: 180 }}
          placeholder={tab === "boats" ? "Search name, owner, slip…" : "Search description, plate…"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {tab === "boats" ? (
        <div className="stack" style={{ gap: 8 }}>
          {filteredBoats.map((b) => {
            const owner = firstOwner(b.owners, b.ownerOrder);
            return (
              <Link
                key={b.id}
                to={`/boats/${b.id}`}
                className="card spread"
                style={{ textDecoration: "none", color: "inherit", flexWrap: "wrap" }}
              >
                <div>
                  <div className="card-title">{b.name}</div>
                  <div className="card-meta">
                    {[b.make, b.model, b.length ? `${b.length} ft` : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                </div>
                <div className="muted small" style={{ textAlign: "right" }}>
                  {b.currentSlip ? b.currentSlip.name : "No slip"}
                  {canViewOwner && owner && (
                    <>
                      <br />
                      {owner.name ?? "Unnamed contact"}
                    </>
                  )}
                </div>
              </Link>
            );
          })}
          {filteredBoats.length === 0 && (
            <div className="placeholder">
              <div className="big">{boats.length === 0 ? "No boats recorded" : "No matches"}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {filteredVehicles.map((v) => {
            const owner = firstOwner(v.owners, v.ownerOrder);
            return (
              <Link
                key={v.id}
                to={`/vehicles/${v.id}`}
                className="card spread"
                style={{ textDecoration: "none", color: "inherit", flexWrap: "wrap" }}
              >
                <div>
                  <div className="card-title">{v.description}</div>
                  <div className="card-meta">Plate: {v.plateNumber ?? "—"}</div>
                </div>
                <div className="muted small" style={{ textAlign: "right" }}>
                  {v.currentLocation ? v.currentLocation.name : "No location"}
                  {canViewOwner && owner && (
                    <>
                      <br />
                      {owner.name ?? "Unnamed contact"}
                    </>
                  )}
                </div>
              </Link>
            );
          })}
          {filteredVehicles.length === 0 && (
            <div className="placeholder">
              <div className="big">
                {vehicles.length === 0 ? "No vehicles recorded" : "No matches"}
              </div>
            </div>
          )}
        </div>
      )}

      {adding && (
        <AddDialog kind={tab === "boats" ? "boat" : "vehicle"} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

function AddDialog({ kind, onClose }: { kind: "boat" | "vehicle"; onClose: () => void }) {
  const [primary, setPrimary] = useState(""); // boat name / vehicle description
  const [secondary, setSecondary] = useState(""); // boat make/model blob / plate

  const save = async () => {
    if (kind === "boat") {
      await db.transact(
        db.tx.boats[id()].update({
          name: primary.trim(),
          description: secondary.trim() || undefined,
        }),
      );
    } else {
      await db.transact(
        db.tx.vehicles[id()].update({
          description: primary.trim(),
          plateNumber: secondary.trim() || undefined,
        }),
      );
    }
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Add {kind}
        </div>
        <div className="field">
          <span className="field-label">{kind === "boat" ? "Name — required" : "Description — required"}</span>
          <input
            className="input"
            value={primary}
            onChange={(e) => setPrimary(e.target.value)}
            placeholder={kind === "vehicle" ? "e.g. White Ford F-250" : undefined}
            autoFocus
          />
        </div>
        <div className="field">
          <span className="field-label">
            {kind === "boat" ? "Notes / description (optional)" : "Plate number (optional)"}
          </span>
          <input className="input" value={secondary} onChange={(e) => setSecondary(e.target.value)} />
        </div>
        <p className="muted small">
          Owners, {kind === "boat" ? "slip" : "location"}, and other details are set from the{" "}
          {kind}'s detail page after creation.
        </p>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!primary.trim()}
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
