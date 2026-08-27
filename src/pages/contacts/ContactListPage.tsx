import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { displayName, isNameless, normalizePhone } from "../../lib/contacts";
import { createContact, useContacts } from "../../data/contacts";
import { useContactCraft } from "../../data/boats";

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

  // No permission branch on the query: without view_owner the contacts table on
  // this device is empty, because the sync stream never delivered a row. The
  // check below is about the nav, not about withholding data.
  const { data: allContacts } = useContacts();

  // Merged-away records never appear; only the canonical target does.
  const contacts = useMemo(
    () =>
      allContacts
        .filter((c) => !c.merged_into_id)
        .sort((a, b) => {
          // Nameless first — they're the ones needing a decision.
          if (isNameless(a) !== isNameless(b)) return isNameless(a) ? -1 : 1;
          return displayName(a).localeCompare(displayName(b), undefined, {
            numeric: true,
          });
        }),
    [allContacts],
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
        {filtered.map((c) => (
          <ContactCard key={c.id} contact={c} canContact={canContact} />
        ))}
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

function ContactCard({
  contact,
  canContact,
}: {
  contact: ReturnType<typeof useContacts>["data"][number];
  canContact: boolean;
}) {
  // The boat count is its own query per row rather than a join, because a
  // contact reaches boats three ways (owner, authorized user, vehicle owner)
  // and a three-way UNION on the list query would multiply every row.
  const { data: craft } = useContactCraft(contact.id);
  const boatCount = craft.filter((c) => c.kind === "boat").length;

  return (
    <Link
      to={`/contacts/${contact.id}`}
      className="card spread"
      style={{ textDecoration: "none", color: "inherit", flexWrap: "wrap" }}
    >
      <div>
        <div className="card-title">
          {displayName(contact)}
          {isNameless(contact) && (
            <span className="badge badge-warn" style={{ marginLeft: 8 }}>
              Needs a name
            </span>
          )}
        </div>
        {canContact && (
          <div className="card-meta">
            {[contact.phone, contact.email].filter(Boolean).join(" · ") ||
              "No contact info"}
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
}

function AddContactDialog({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "" });

  const current = useCurrent();

  const save = async () => {
    await createContact(
      {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      },
      current.user?.id ?? null,
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
