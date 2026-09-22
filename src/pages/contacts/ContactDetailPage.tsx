import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { displayName, isNameless } from "../../lib/contacts";
import { TargetActivity } from "../shared/TargetActivity";
import { NamelessContactDialog } from "./NamelessContactDialog";
import {
  saveContact,
  useContact,
  useMergedContacts,
  type ContactRow,
} from "../../data/contacts";
import { useContactCraft } from "../../data/boats";
import { useLeasesForContact } from "../../data/leases";

// Owners & Contacts — Contact Detail (see docs/pages/contact-detail.html).
// Assumes a named contact: a nameless one routes into the name/merge prompt
// first, and a merged-away one reroutes to its canonical record.
export function ContactDetailPage() {
  const { id: contactId } = useParams();
  const current = useCurrent();
  const navigate = useNavigate();
  const canView = current.can("view_owner");
  const canContact = current.can("view_contact");
  const canEdit = current.can("edit_owner_contact");
  const [editing, setEditing] = useState(false);
  const [dismissedPrompt, setDismissedPrompt] = useState(false);

  const { contact } = useContact(contactId);
  const { data: craft } = useContactCraft(contactId);
  const { data: leases } = useLeasesForContact(contactId);
  const { data: mergedFrom } = useMergedContacts(contactId);

  if (!canView) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
      </div>
    );
  }
  if (!contact) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  // Viewing a merged-away record shows the canonical person instead.
  if (contact.merged_into_id) {
    return <Navigate to={`/contacts/${contact.merged_into_id}`} replace />;
  }

  if (isNameless(contact) && !dismissedPrompt) {
    return (
      <NamelessContactDialog
        contact={contact}
        onResolved={(canonicalId) => {
          if (canonicalId !== contact.id) navigate(`/contacts/${canonicalId}`, { replace: true });
        }}
        onDismiss={() => setDismissedPrompt(true)}
      />
    );
  }

  const ownedBoats = craft.filter((c) => c.kind === "boat" && c.role === "Owner");
  const authorizedBoats = craft.filter(
    (c) => c.kind === "boat" && c.role === "Authorized",
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{displayName(contact)}</h1>
          {canContact && (
            <div className="page-sub">
              {[contact.phone, contact.email].filter(Boolean).join(" · ") ||
                "No contact info on file"}
            </div>
          )}
        </div>
        <div className="row">
          {canContact && contact.phone && current.can("place_calls") && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => navigate("/comms")}
              title="Opens the dialer pre-filled with this contact"
            >
              Call / text
            </button>
          )}
          {canEdit && !editing && (
            <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          {editing && <EditContact contact={contact} onDone={() => setEditing(false)} />}

          {ownedBoats.length > 0 && (
            <div>
              <div className="section-title">Boats owned</div>
              <div className="stack" style={{ gap: 6 }}>
                {ownedBoats.map((b) => (
                  <Link
                    key={b.id}
                    to={`/boats/${b.id}`}
                    className="card"
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    {b.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {authorizedBoats.length > 0 && (
            <div>
              <div className="section-title">Authorized on</div>
              <div className="stack" style={{ gap: 6 }}>
                {authorizedBoats.map((b) => (
                  <Link
                    key={b.id}
                    to={`/boats/${b.id}`}
                    className="card"
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    {b.label}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {current.can("view_lease") && leases.length > 0 && (
            <div>
              <div className="section-title">Leases</div>
              <div className="stack" style={{ gap: 6 }}>
                {leases.map((l) => (
                  <Link
                    key={l.id}
                    to={`/contacts/leases/${l.id}`}
                    className="card spread"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <span>{l.location_name ?? "Lease"}</span>
                    <span className="muted small">
                      {l.end_date
                        ? `through ${new Date(l.end_date).toLocaleDateString()}`
                        : "open-ended"}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {mergedFrom.length > 0 && canEdit && (
            <p className="muted small">
              {mergedFrom.length} other record
              {mergedFrom.length === 1 ? " has" : "s have"} been merged into this
              contact.
            </p>
          )}
        </div>

        <TargetActivity
          target={{ type: "contact", id: contact.id, label: displayName(contact) }}
        />
      </div>
    </div>
  );
}

function EditContact({
  contact,
  onDone,
}: {
  contact: ContactRow;
  onDone: () => void;
}) {
  const current = useCurrent();
  const [form, setForm] = useState({
    name: contact.name ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
  });

  const save = async () => {
    await saveContact(
      contact,
      {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
      },
      current.user?.id ?? null,
    );
    onDone();
  };

  return (
    <div className="card">
      {(["name", "phone", "email"] as const).map((k) => (
        <div className="field" key={k}>
          <span className="field-label">
            {k.charAt(0).toUpperCase() + k.slice(1)}
          </span>
          <input
            className="input"
            value={form[k]}
            onChange={(e) => setForm({ ...form, [k]: e.target.value })}
          />
        </div>
      ))}
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
