import { useState } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { compareNames } from "../../lib/locations";
import {
  createBoat,
  createVehicle,
  useBoats,
  useVehicles,
} from "../../data/boats";

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

  // owner_names is the boat's owners joined in succession order, so the search
  // below matches on any of them without a second query per row.
  const { data: boats } = useBoats();
  const { data: vehicles } = useVehicles();

  const q = search.trim().toLowerCase();
  const matches = (...parts: (string | null | undefined)[]) =>
    !q || parts.some((p) => p?.toLowerCase().includes(q));

  const filteredBoats = boats
    .filter((b) =>
      matches(
        b.name,
        b.make,
        b.model,
        b.location_name,
        canViewOwner ? b.owner_names : null,
      ),
    )
    .sort((a, b) => compareNames(a.name, b.name));
  const filteredVehicles = vehicles
    .filter((v) =>
      matches(
        v.description,
        v.plate_number,
        v.location_name,
        canViewOwner ? v.owner_names : null,
      ),
    )
    .sort((a, b) => compareNames(a.description, b.description));

  // The first name in owner_names is the primary owner: boat_owners.position
  // is what orders that join, so succession is a database fact now rather
  // than a json array the client had to keep in step with the links.
  const firstOwner = (ownerNames: string | null) =>
    ownerNames?.split(", ")[0] || null;

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
            const owner = firstOwner(b.owner_names);
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
                  {b.location_name ?? "No slip"}
                  {canViewOwner && owner && (
                    <>
                      <br />
                      {owner}
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
            const owner = firstOwner(v.owner_names);
            return (
              <Link
                key={v.id}
                to={`/vehicles/${v.id}`}
                className="card spread"
                style={{ textDecoration: "none", color: "inherit", flexWrap: "wrap" }}
              >
                <div>
                  <div className="card-title">{v.description}</div>
                  <div className="card-meta">Plate: {v.plate_number ?? "—"}</div>
                </div>
                <div className="muted small" style={{ textAlign: "right" }}>
                  {v.location_name ?? "No location"}
                  {canViewOwner && owner && (
                    <>
                      <br />
                      {owner}
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
      await createBoat({ name: primary.trim(), description: secondary.trim() || null });
    } else {
      await createVehicle({
        description: primary.trim(),
        plateNumber: secondary.trim() || null,
      });
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
