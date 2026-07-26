import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { displayName, isNameless } from "../../lib/contacts";
import { TargetActivity } from "../shared/TargetActivity";
import { NamelessContactDialog } from "./NamelessContactDialog";

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

  const { data } = db.useQuery(
    canView && contactId
      ? {
          contacts: {
            $: { where: { id: contactId } },
            mergedInto: {},
            mergedFrom: {},
            ownedBoats: {},
            authorizedBoats: {},
            leases: { location: {} },
            notes: { author: {} },
            incidents: {},
            tickets: {},
          },
        }
      : null,
  );
  const contact = data?.contacts?.[0];

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
  if (contact.mergedInto) {
    return <Navigate to={`/contacts/${contact.mergedInto.id}`} replace />;
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

  const leases = contact.leases ?? [];

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

          {(contact.ownedBoats ?? []).length > 0 && (
            <div>
              <div className="section-title">Boats owned</div>
              <div className="stack" style={{ gap: 6 }}>
                {(contact.ownedBoats ?? []).map((b) => (
                  <Link
                    key={b.id}
                    to={`/boats/${b.id}`}
                    className="card"
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    {b.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {(contact.authorizedBoats ?? []).length > 0 && (
            <div>
              <div className="section-title">Authorized on</div>
              <div className="stack" style={{ gap: 6 }}>
                {(contact.authorizedBoats ?? []).map((b) => (
                  <Link
                    key={b.id}
                    to={`/boats/${b.id}`}
                    className="card"
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    {b.name}
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
                    <span>{l.location?.name ?? "Lease"}</span>
                    <span className="muted small">
                      {l.endDate
                        ? `through ${new Date(l.endDate).toLocaleDateString()}`
                        : "open-ended"}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {(contact.mergedFrom ?? []).length > 0 && canEdit && (
            <p className="muted small">
              {(contact.mergedFrom ?? []).length} other record
              {(contact.mergedFrom ?? []).length === 1 ? " has" : "s have"} been merged
              into this contact.
            </p>
          )}
        </div>

        <TargetActivity
          target={{ type: "contact", id: contact.id, label: displayName(contact) }}
          notes={contact.notes ?? []}
          incidents={contact.incidents ?? []}
          tickets={contact.tickets ?? []}
        />
      </div>
    </div>
  );
}

function EditContact({
  contact,
  onDone,
}: {
  contact: { id: string; name?: string | null; phone?: string | null; email?: string | null };
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: contact.name ?? "",
    phone: contact.phone ?? "",
    email: contact.email ?? "",
  });

  const save = async () => {
    await db.transact(
      db.tx.contacts[contact.id].update({
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
      }),
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
