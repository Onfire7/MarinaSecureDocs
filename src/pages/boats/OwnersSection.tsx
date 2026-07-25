import { useState } from "react";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";

type Contact = { id: string; name?: string | null; phone?: string | null; email?: string | null };

// Ordered owners-in-succession for a Boat or Vehicle (see docs/pages/
// boat-detail.html / vehicle-detail.html): order = who to contact first,
// stored in the entity's ownerOrder json since links are unordered sets.
// Omitted entirely (by the caller) without view_owner or when empty —
// "unknown owner" and "can't see it" look identical by design.
export function OwnersSection({
  entityType,
  entityId,
  owners,
  ownerOrder,
}: {
  entityType: "boats" | "vehicles";
  entityId: string;
  owners: Contact[];
  ownerOrder: string[] | undefined;
}) {
  const current = useCurrent();
  const canEdit = current.can("edit_owner_contact");
  const canContact = current.can("view_contact");
  const [addingId, setAddingId] = useState("");

  const { data } = db.useQuery(canEdit ? { contacts: {} } : null);
  const allContacts = data?.contacts ?? [];

  const ordered = orderOwners(owners, ownerOrder);
  const tx = db.tx[entityType][entityId];

  const persistOrder = (ids: string[]) => {
    void db.transact(tx.update({ ownerOrder: ids }));
  };

  const move = (contactId: string, delta: -1 | 1) => {
    const ids = ordered.map((o) => o.id);
    const idx = ids.indexOf(contactId);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= ids.length) return;
    [ids[idx], ids[target]] = [ids[target], ids[idx]];
    persistOrder(ids);
  };

  const add = () => {
    if (!addingId) return;
    void db.transact([
      tx.link({ owners: addingId }),
      tx.update({ ownerOrder: [...ordered.map((o) => o.id), addingId] }),
    ]);
    setAddingId("");
  };

  const remove = (contactId: string) => {
    void db.transact([
      tx.unlink({ owners: contactId }),
      tx.update({ ownerOrder: ordered.map((o) => o.id).filter((i) => i !== contactId) }),
    ]);
  };

  return (
    <div>
      <div className="section-title">
        Owners{ordered.length > 1 ? " — succession order" : ""}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {ordered.map((o, i) => (
          <div key={o.id} className="card spread">
            <span>
              {ordered.length > 1 && <span className="muted small">{i + 1}. </span>}
              {o.name ?? "Unnamed contact"}
              {canContact && (
                <span className="muted small">
                  {o.phone ? ` · ${o.phone}` : ""}
                  {o.email ? ` · ${o.email}` : ""}
                </span>
              )}
            </span>
            {canEdit && (
              <span className="row" style={{ gap: 4 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  disabled={i === 0}
                  onClick={() => move(o.id, -1)}
                  aria-label="Move up in succession"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  disabled={i === ordered.length - 1}
                  onClick={() => move(o.id, 1)}
                  aria-label="Move down in succession"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => remove(o.id)}
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
                .filter((c) => !ordered.some((o) => o.id === c.id))
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

function orderOwners(
  owners: Contact[],
  ownerOrder: string[] | undefined,
): Contact[] {
  if (!ownerOrder || ownerOrder.length === 0) return owners;
  const byId = new Map(owners.map((o) => [o.id, o]));
  const ordered = ownerOrder
    .map((id) => byId.get(id))
    .filter((o): o is Contact => Boolean(o));
  const inOrder = new Set(ownerOrder);
  return [...ordered, ...owners.filter((o) => !inOrder.has(o.id))];
}
