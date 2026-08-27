import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { compareNames } from "../../lib/locations";
import { OwnersSection } from "./OwnersSection";
import { TargetActivity } from "../shared/TargetActivity";
import { LocationPicker } from "../shared/LocationPicker";
import {
  haulOutBoat,
  moveBoat,
  saveBoat,
  useBoat,
  useBoatAuthorizedUsers,
  type BoatRow,
} from "../../data/boats";
import { useLocationsHolding } from "../../data/locations";
import { useLeasesForLocation } from "../../data/leases";
import { useMarinaSettings } from "../../data/settings";
import { useTicketStatuses } from "../../data/lookups";

// Boats & Vehicles — Boat Detail (see docs/pages/boat-detail.html).
// Owner/authorized-user sections require view_owner (omitted entirely
// without it, or when no owners are recorded); edits and slip reassignment
// require edit_owner_contact.
export function BoatDetailPage() {
  const { id: boatId } = useParams();
  const current = useCurrent();
  const canEdit = current.can("edit_owner_contact");
  const [editing, setEditing] = useState(false);
  const [haulingOut, setHaulingOut] = useState(false);

  const { boat } = useBoat(boatId);
  const { data: slipOptionsRaw } = useLocationsHolding("boat");
  const { data: authorizedUsers } = useBoatAuthorizedUsers(boatId);
  const { data: slipLeases } = useLeasesForLocation(boat?.location_id ?? undefined);
  const settings = useMarinaSettings();
  const { statuses: ticketStatuses } = useTicketStatuses();

  const slipOptions = [...slipOptionsRaw].sort((a, b) => compareNames(a.name, b.name));

  if (!boat) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const now = Date.now();
  const activeLease = slipLeases.find(
    (l) =>
      (!l.start_date || new Date(l.start_date).getTime() <= now) &&
      (!l.end_date || new Date(l.end_date).getTime() >= now),
  );
  const actorId = current.user?.id ?? null;
  const currentSlip = boat.location_id
    ? { id: boat.location_id, name: boat.location_name ?? "its slip" }
    : null;

  const reassignSlip = (locationId: string) => {
    if (!locationId) return;
    const to = slipOptions.find((l) => l.id === locationId);
    void moveBoat(boat, currentSlip, to ?? null, actorId);
  };

  // Hauling out clears the slip entirely — the boat is out of the water, not
  // moving between slips. A marina haul-out also raises a ticket for the work;
  // whether we ask is a marina-wide setting.
  const haulOut = (byMarina: boolean) => {
    if (!currentSlip) return;
    const openStatus = ticketStatuses.find((st) => st.is_terminal === 0);
    void haulOutBoat(boat, currentSlip, byMarina, openStatus?.id ?? null, actorId);
    setHaulingOut(false);
  };

  const startHaulOut = () => {
    if (settings.haulOutMode === "customer") haulOut(false);
    else setHaulingOut(true);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{boat.name}</h1>
          <div className="page-sub">
            {[boat.make, boat.model, boat.length ? `${boat.length} ft` : null]
              .filter(Boolean)
              .join(" · ") || "No make/model recorded"}
            {boat.registration_number && ` · Reg ${boat.registration_number}`}
          </div>
        </div>
        {canEdit && !editing && (
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>

      <div className="grid-2">
        <div className="stack">
          {editing ? (
            <EditBoat
              boat={boat}
              onDone={() => setEditing(false)}
            />
          ) : (
            boat.description && (
              <div className="card">
                <div className="small" style={{ whiteSpace: "pre-wrap" }}>{boat.description}</div>
              </div>
            )
          )}

          <div className="field">
            <span className="field-label">Current slip</span>
            <div className="field-value row">
              {currentSlip ? (
                <Link to={`/locations/${currentSlip.id}`}>{currentSlip.name}</Link>
              ) : (
                <span className="muted">Unassigned</span>
              )}
              {canEdit && (
                <>
                  <div style={{ minWidth: 240 }}>
                    <LocationPicker
                      locations={slipOptions}
                      value=""
                      onChange={reassignSlip}
                      allowNone={false}
                      placeholder="Reassign to a slip…"
                    />
                  </div>
                  {currentSlip && (
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      onClick={startHaulOut}
                    >
                      Haul out
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {current.can("view_lease") && activeLease && (
            <div className="field">
              <span className="field-label">Lease</span>
              <div className="field-value">
                {activeLease.lessee_names || "Lease on file"}
                <span className="muted small">
                  {activeLease.end_date
                    ? ` · through ${new Date(activeLease.end_date).toLocaleDateString()}`
                    : " · open-ended"}
                </span>
              </div>
            </div>
          )}

          {current.can("view_owner") && (
            <>
              <OwnersSection entityType="boats" entityId={boat.id} />
              {authorizedUsers.length > 0 && (
                <div>
                  <div className="section-title">Authorized users</div>
                  <div className="stack" style={{ gap: 6 }}>
                    {authorizedUsers.map((c) => (
                      <div key={c.link_id} className="card">
                        {c.name ?? "Unnamed contact"}
                        {current.can("view_contact") && c.phone && (
                          <span className="muted small">{` · ${c.phone}`}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <TargetActivity target={{ type: "boat", id: boat.id, label: boat.name }} />
      </div>

      {haulingOut && (
        <div className="dialog-backdrop" onClick={() => setHaulingOut(false)}>
          <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-title" style={{ marginBottom: 10 }}>
              Haul out {boat.name}
            </div>
            <p className="muted small">
              This frees {currentSlip?.name}. Who is performing the haul-out?
            </p>
            <div className="stack" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-block"
                onClick={() => haulOut(true)}
              >
                Marina — raise a ticket for the work
              </button>
              <button
                type="button"
                className="btn btn-block"
                onClick={() => haulOut(false)}
              >
                Customer — no ticket
              </button>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => setHaulingOut(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EditBoat({ boat, onDone }: { boat: BoatRow; onDone: () => void }) {
  const [form, setForm] = useState({
    name: boat.name,
    description: boat.description ?? "",
    make: boat.make ?? "",
    model: boat.model ?? "",
    length: boat.length != null ? String(boat.length) : "",
    registrationNumber: boat.registration_number ?? "",
  });

  const save = async () => {
    await saveBoat(boat.id, {
      name: form.name.trim(),
      description: form.description.trim() || null,
      make: form.make.trim() || null,
      model: form.model.trim() || null,
      length: form.length === "" ? null : Number(form.length),
      registrationNumber: form.registrationNumber.trim() || null,
    });
    onDone();
  };

  const field = (label: string, key: keyof typeof form, type = "text") => (
    <div className="field">
      <span className="field-label">{label}</span>
      <input
        className="input"
        type={type}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="card">
      {field("Name", "name")}
      {field("Make", "make")}
      {field("Model", "model")}
      {field("Length (ft)", "length", "number")}
      {field("Registration number", "registrationNumber")}
      <div className="field">
        <span className="field-label">Description</span>
        <textarea
          className="textarea"
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!form.name.trim()}
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
