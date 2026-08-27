import { useState } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useContacts } from "../../data/contacts";
import {
  addBoatOwner,
  addVehicleOwner,
  removeAttachedContact,
  reorderOwners,
  useBoatOwners,
  useVehicleOwners,
} from "../../data/boats";

// Ordered owners-in-succession for a boat or vehicle (see docs/pages/
// boat-detail.html / vehicle-detail.html): order = who to contact first.
//
// That order used to live in an `ownerOrder` json array on the boat, because
// Instant's links were an unordered set and there was nowhere else to put it —
// which meant two writes per change and two things that could disagree. It is
// now boat_owners.position, so the order IS the link, and adding an owner
// cannot leave them unranked.
//
// Omitted entirely (by the caller) without view_owner or when empty — "unknown
// owner" and "can't see it" look identical by design.
export function OwnersSection({
  entityType,
  entityId,
}: {
  entityType: "boats" | "vehicles";
  entityId: string;
}) {
  const current = useCurrent();
  const canEdit = current.can("edit_owner_contact");
  const canContact = current.can("view_contact");
  const [addingId, setAddingId] = useState("");

  const linkTable = entityType === "boats" ? "boat_owners" : "vehicle_owners";
  const boatOwners = useBoatOwners(entityType === "boats" ? entityId : undefined);
  const vehicleOwners = useVehicleOwners(
    entityType === "vehicles" ? entityId : undefined,
  );
  const ordered = entityType === "boats" ? boatOwners.data : vehicleOwners.data;

  const { data: allContacts } = useContacts();

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    const ids = ordered.map((o) => o.link_id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void reorderOwners(linkTable, ids);
  };

  const add = () => {
    if (!addingId) return;
    const position = ordered.length;
    void (entityType === "boats"
      ? addBoatOwner(entityId, addingId, position)
      : addVehicleOwner(entityId, addingId, position));
    setAddingId("");
  };

  const removeOwner = (linkId: string) => {
    // Positions are left with a gap rather than rewritten. Order is all that
    // is read, never the numbers themselves, and rewriting every remaining row
    // would push each of them to every device holding this boat.
    void removeAttachedContact(linkTable, linkId);
  };

  return (
    <div>
      <div className="section-title">
        Owners{ordered.length > 1 ? " — succession order" : ""}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {ordered.map((o, i) => (
          <div key={o.link_id} className="card spread">
            <span>
              {ordered.length > 1 && <span className="muted small">{i + 1}. </span>}
              <Link to={`/contacts/${o.contact_id}`}>
                {o.name ?? "Unnamed contact"}
              </Link>
              {canContact && o.phone && (
                <span className="muted small">{` · ${o.phone}`}</span>
              )}
            </span>
            {canEdit && (
              <span className="row" style={{ gap: 4 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label="Move up in succession"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  disabled={i === ordered.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label="Move down in succession"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => removeOwner(o.link_id)}
                >
                  Remove
                </button>
              </span>
            )}
          </div>
        ))}
        {ordered.length === 0 && <span className="muted small">No owners recorded.</span>}
        {canEdit && (
          <div className="row">
            <select
              className="select select-inline"
              value={addingId}
              onChange={(e) => setAddingId(e.target.value)}
            >
              <option value="">Add owner…</option>
              {allContacts
                .filter((c) => !ordered.some((o) => o.contact_id === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ?? "Unnamed contact"}
                  </option>
                ))}
            </select>
            <button type="button" className="btn btn-sm" disabled={!addingId} onClick={add}>
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
