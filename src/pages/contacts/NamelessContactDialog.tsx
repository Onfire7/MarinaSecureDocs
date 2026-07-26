import { useMemo, useState } from "react";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { displayName, findSimilarContacts, type ContactLike } from "../../lib/contacts";
import { activityTx } from "../../lib/activityLog";

// Owners & Contacts — Nameless-Contact Name Prompt & Merge Dialog (see
// docs/pages/nameless-contact-merge.html). An unmatched inbound call/text
// auto-creates a bare Contact (phone only); this is where that becomes a
// real record — and where it's caught before becoming a duplicate.
// Similar contacts only surface once a name is typed; there's nothing to
// match against beforehand.
export function NamelessContactDialog({
  contact,
  onResolved,
  onDismiss,
}: {
  contact: ContactLike;
  onResolved: (canonicalId: string) => void;
  onDismiss: () => void;
}) {
  const current = useCurrent();
  const canEdit = current.can("edit_owner_contact");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const { data } = db.useQuery(canEdit ? { contacts: { mergedInto: {} } } : null);
  const similar = useMemo(
    () => findSimilarContacts(name, contact, data?.contacts ?? []),
    [name, contact, data],
  );

  const saveName = async () => {
    await db.transact([
      db.tx.contacts[contact.id].update({ name: name.trim() }),
      activityTx({
        eventType: "contact.named",
        summary: `Unnamed contact ${contact.phone ?? ""} named "${name.trim()}"`.trim(),
        subjectType: "contacts",
        subjectId: contact.id,
        actorId: current.user?.id,
      }),
    ]);
    onResolved(contact.id);
  };

  // The nameless record keeps its phone number (so future calls from it still
  // match directly); display resolves through mergedInto to the canonical one.
  const confirmMerge = async () => {
    if (!selected) return;
    const into = similar.find((c) => c.id === selected);
    await db.transact([
      db.tx.contacts[contact.id].link({ mergedInto: selected }),
      activityTx({
        eventType: "contact.merged",
        summary:
          `Contact ${contact.phone ?? "record"} merged into ` +
          `${into ? displayName(into) : "another contact"}`,
        subjectType: "contacts",
        subjectId: selected,
        actorId: current.user?.id,
      }),
    ]);
    onResolved(selected);
  };

  if (!canEdit) {
    return (
      <div className="dialog-backdrop" onClick={onDismiss}>
        <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
          <div className="card-title" style={{ marginBottom: 10 }}>
            No name on file yet
          </div>
          <p className="muted small">
            {contact.phone ?? "Unknown number"} — this contact hasn't been named yet.
          </p>
          <button type="button" className="btn" onClick={onDismiss}>
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" onClick={onDismiss}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 4 }}>
          Who is this?
        </div>
        <p className="muted small">
          {contact.phone ?? "Unknown number"} — auto-created from an inbound call or
          text, never named.
        </p>

        <div className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSelected(null);
            }}
            autoFocus
          />
        </div>

        {similar.length > 0 && (
          <div className="field">
            <span className="field-label">
              Possibly the same person already on file
            </span>
            <div className="stack" style={{ gap: 6 }}>
              {similar.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={"card spread" + (selected === c.id ? " card-done" : "")}
                  style={{ cursor: "pointer", textAlign: "left", font: "inherit" }}
                  onClick={() => setSelected(selected === c.id ? null : c.id)}
                >
                  <span>
                    <span style={{ fontWeight: 650 }}>{displayName(c)}</span>
                    {c.phone && <span className="muted small"> · {c.phone}</span>}
                  </span>
                  {selected === c.id && <span className="badge badge-good">Merge</span>}
                </button>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: 6 }}>
              Pick one to merge into, or save as a new contact — none of these has to
              be the same person.
            </p>
          </div>
        )}

        <div className="row">
          {selected ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void confirmMerge()}
            >
              Merge into {displayName(similar.find((c) => c.id === selected)!)}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!name.trim()}
              onClick={() => void saveName()}
            >
              Save as new contact
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={onDismiss}>
            Decide later
          </button>
        </div>
      </div>
    </div>
  );
}
