import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { displayName, isNameless, normalizePhone } from "../../lib/contacts";

// Owners & Contacts — Contact List (see docs/pages/contact-list.html).
// A Contact isn't necessarily a User; most entries never sign in. Names
// require view_owner, phone/email additionally require view_contact.
export function ContactListPage() {
  const current = useCurrent();
  const canView = current.can("view_owner");
  const canContact = current.can("view_contact");
  const canEdit = current.can("edit_owner_contact");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);

  const { data } = db.useQuery(
    canView
      ? {
          contacts: {
            mergedInto: {},
            ownedBoats: {},
            authorizedBoats: {},
          },
        }
      : null,
  );

  // Merged-away records never appear; only the canonical target does.
  const contacts = useMemo(
    () =>
      [...(data?.contacts ?? [])]
        .filter((c) => !c.mergedInto)
        .sort((a, b) => {
          // Nameless first — they're the ones needing a decision.
          if (isNameless(a) !== isNameless(b)) return isNameless(a) ? -1 : 1;
          return displayName(a).localeCompare(displayName(b), undefined, {
            numeric: true,
          });
        }),
    [data],
  );

  if (!canView) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
      </div>
    );
  }

  const q = search.trim().toLowerCase();
  const qDigits = normalizePhone(search);
  const filtered = contacts.filter((c) => {
    if (!q) return true;
    if (c.name?.toLowerCase().includes(q)) return true;
    if (qDigits && normalizePhone(c.phone).includes(qDigits)) return true;
    return false;
  });

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Owners & Contacts</h1>
        {canEdit && (
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => setAdding(true)}
          >
            + Add contact
          </button>
        )}
      </div>

      <div className="chip-row">
        <input
          className="input select-inline"
          style={{ minWidth: 220 }}
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="stack" style={{ gap: 8 }}>
        {filtered.map((c) => {
          const boatCount =
            (c.ownedBoats ?? []).length + (c.authorizedBoats ?? []).length;
          return (
            <Link
              key={c.id}
              to={`/contacts/${c.id}`}
              className="card spread"
              style={{ textDecoration: "none", color: "inherit", flexWrap: "wrap" }}
            >
              <div>
                <div className="card-title">
                  {displayName(c)}
                  {isNameless(c) && (
                    <span className="badge badge-warn" style={{ marginLeft: 8 }}>
                      Needs a name
                    </span>
                  )}
                </div>
                {canContact && (
                  <div className="card-meta">
                    {[c.phone, c.email].filter(Boolean).join(" · ") || "No contact info"}
                  </div>
                )}
              </div>
              {boatCount > 0 && (
                <span className="badge">
                  {boatCount} boat{boatCount === 1 ? "" : "s"}
                </span>
              )}
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <div className="placeholder">
            <div className="big">
              {contacts.length === 0 ? "No contacts yet" : "No matches"}
            </div>
          </div>
        )}
      </div>

      {adding && <AddContactDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddContactDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "" });

  const save = async () => {
    await db.transact(
      db.tx.contacts[id()].update({
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
      }),
    );
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Add contact
        </div>
        {(["name", "phone", "email"] as const).map((k) => (
          <div className="field" key={k}>
            <span className="field-label">
              {k === "name" ? "Name — required" : k === "phone" ? "Phone" : "Email"}
            </span>
            <input
              className="input"
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              autoFocus={k === "name"}
            />
          </div>
        ))}
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!form.name.trim()}
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
