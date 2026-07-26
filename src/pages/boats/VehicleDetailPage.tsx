import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { compareNames } from "../../lib/locations";
import { OwnersSection } from "./OwnersSection";
import { TargetActivity } from "../shared/TargetActivity";
import { activityTx } from "../../lib/activityLog";

// Boats & Vehicles — Vehicle Detail (see docs/pages/vehicle-detail.html).
// Mirrors Boat Detail: a partial record ("trailer, no plate, by the fuel
// dock") is exactly what this entity exists to hold — owners and plate are
// both optional.
export function VehicleDetailPage() {
  const { id: vehicleId } = useParams();
  const current = useCurrent();
  const canEdit = current.can("edit_owner_contact");
  const [editing, setEditing] = useState(false);

  const { data } = db.useQuery(
    vehicleId
      ? {
          vehicles: {
            $: { where: { id: vehicleId } },
            owners: {},
            currentLocation: {},
            notes: { author: {} },
            incidents: {},
            tickets: {},
          },
          locations: { $: { where: { "type.hasVehicle": true } } },
        }
      : null,
  );
  const vehicle = data?.vehicles?.[0];
  const locationOptions = [...(data?.locations ?? [])].sort((a, b) =>
    compareNames(a.name, b.name),
  );

  if (!vehicle) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const reassign = (locationId: string) => {
    if (!locationId) return;
    const to = locationOptions.find((l) => l.id === locationId);
    void db.transact([
      db.tx.vehicles[vehicle.id].link({ currentLocation: locationId }),
      activityTx({
        eventType: "vehicle.location_changed",
        summary: `${vehicle.description} moved to ${to?.name ?? "another location"}`,
        subjectType: "vehicles",
        subjectId: vehicle.id,
        actorId: current.user?.id,
      }),
    ]);
  };
  const clearLocation = () => {
    if (!vehicle.currentLocation) return;
    const from = vehicle.currentLocation.name;
    void db.transact([
      db.tx.vehicles[vehicle.id].unlink({ currentLocation: vehicle.currentLocation.id }),
      activityTx({
        eventType: "vehicle.departed",
        summary: `${vehicle.description} departed ${from}`,
        subjectType: "vehicles",
        subjectId: vehicle.id,
        actorId: current.user?.id,
      }),
    ]);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{vehicle.description}</h1>
          <div className="page-sub">Plate: {vehicle.plateNumber ?? "—"}</div>
        </div>
        {canEdit && !editing && (
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>

      <div className="grid-2">
        <div className="stack">
          {editing && (
            <EditVehicle
              vehicle={vehicle}
              onDone={() => setEditing(false)}
            />
          )}

          <div className="field">
            <span className="field-label">Current location</span>
            <div className="field-value row">
              {vehicle.currentLocation ? (
                <Link to={`/locations/${vehicle.currentLocation.id}`}>
                  {vehicle.currentLocation.name}
                </Link>
              ) : (
                <span className="muted">Unassigned</span>
              )}
              {canEdit && (
                <>
                  <select
                    className="select select-inline"
                    value=""
                    onChange={(e) => reassign(e.target.value)}
                  >
                    <option value="">Reassign…</option>
                    {locationOptions
                      .filter((l) => l.id !== vehicle.currentLocation?.id)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                  {vehicle.currentLocation && (
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      onClick={clearLocation}
                    >
                      Departed
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {current.can("view_owner") && (
            <OwnersSection
              entityType="vehicles"
              entityId={vehicle.id}
              owners={vehicle.owners ?? []}
              ownerOrder={vehicle.ownerOrder}
            />
          )}
        </div>

        <TargetActivity
          target={{ type: "vehicle", id: vehicle.id, label: vehicle.description }}
          notes={vehicle.notes ?? []}
          incidents={vehicle.incidents ?? []}
          tickets={vehicle.tickets ?? []}
        />
      </div>
    </div>
  );
}

function EditVehicle({
  vehicle,
  onDone,
}: {
  vehicle: { id: string; description: string; plateNumber?: string | null };
  onDone: () => void;
}) {
  const [description, setDescription] = useState(vehicle.description);
  const [plate, setPlate] = useState(vehicle.plateNumber ?? "");

  const save = async () => {
    await db.transact(
      db.tx.vehicles[vehicle.id].update({
        description: description.trim(),
        plateNumber: plate.trim() || undefined,
      }),
    );
    onDone();
  };

  return (
    <div className="card">
      <div className="field">
        <span className="field-label">Description</span>
        <input
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="field">
        <span className="field-label">Plate number (optional)</span>
        <input className="input" value={plate} onChange={(e) => setPlate(e.target.value)} />
      </div>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!description.trim()}
          onClick={() => void save()}
        >
          Save
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
