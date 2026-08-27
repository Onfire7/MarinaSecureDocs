import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { compareNames } from "../../lib/locations";
import { OwnersSection } from "./OwnersSection";
import { TargetActivity } from "../shared/TargetActivity";
import { LocationPicker } from "../shared/LocationPicker";
import {
  moveVehicle,
  saveVehicle,
  useVehicle,
  type VehicleRow,
} from "../../data/boats";
import { useLocationsHolding } from "../../data/locations";

// Boats & Vehicles — Vehicle Detail (see docs/pages/vehicle-detail.html).
// Mirrors Boat Detail: a partial record ("trailer, no plate, by the fuel
// dock") is exactly what this entity exists to hold — owners and plate are
// both optional.
export function VehicleDetailPage() {
  const { id: vehicleId } = useParams();
  const current = useCurrent();
  const canEdit = current.can("edit_owner_contact");
  const [editing, setEditing] = useState(false);

  const { vehicle } = useVehicle(vehicleId);
  const { data: options } = useLocationsHolding("vehicle");
  const locationOptions = [...options].sort((a, b) => compareNames(a.name, b.name));

  if (!vehicle) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const actorId = current.user?.id ?? null;
  const currentLocation = vehicle.location_id
    ? { id: vehicle.location_id, name: vehicle.location_name ?? "its location" }
    : null;

  const reassign = (locationId: string) => {
    if (!locationId) return;
    const to = locationOptions.find((l) => l.id === locationId);
    void moveVehicle(vehicle, currentLocation, to ?? null, actorId);
  };
  const clearLocation = () => {
    if (!currentLocation) return;
    void moveVehicle(vehicle, currentLocation, null, actorId);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{vehicle.description}</h1>
          <div className="page-sub">Plate: {vehicle.plate_number ?? "—"}</div>
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
              {currentLocation ? (
                <Link to={`/locations/${currentLocation.id}`}>
                  {currentLocation.name}
                </Link>
              ) : (
                <span className="muted">Unassigned</span>
              )}
              {canEdit && (
                <>
                  <div style={{ minWidth: 240 }}>
                    <LocationPicker
                      locations={locationOptions}
                      value=""
                      onChange={reassign}
                      allowNone={false}
                      placeholder="Reassign to a location…"
                    />
                  </div>
                  {currentLocation && (
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
            <OwnersSection entityType="vehicles" entityId={vehicle.id} />
          )}
        </div>

        <TargetActivity
          target={{ type: "vehicle", id: vehicle.id, label: vehicle.description }}
        />
      </div>
    </div>
  );
}

function EditVehicle({
  vehicle,
  onDone,
}: {
  vehicle: VehicleRow;
  onDone: () => void;
}) {
  const [description, setDescription] = useState(vehicle.description);
  const [plate, setPlate] = useState(vehicle.plate_number ?? "");

  const save = async () => {
    await saveVehicle(vehicle.id, {
      description: description.trim(),
      plateNumber: plate.trim() || null,
    });
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
