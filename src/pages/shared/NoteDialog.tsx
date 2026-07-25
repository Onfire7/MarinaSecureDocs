import { useState } from "react";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { attachmentLink, type AttachmentTarget } from "../../lib/attachments";

// Minimal pre-attached note entry — the full shared New Note dialog (with a
// free target picker) arrives with the Shared dialogs group; callers here
// always know the target already.
export function NoteDialog({
  target,
  onClose,
}: {
  target: AttachmentTarget;
  onClose: () => void;
}) {
  const current = useCurrent();
  const [body, setBody] = useState("");

  const save = async () => {
    await db.transact(
      db.tx.notes[id()]
        .update({ body: body.trim(), createdAt: Date.now() })
        .link({
          ...attachmentLink(target),
          ...(current.user ? { author: current.user.id } : {}),
        }),
    );
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          New note — {target.label}
        </div>
        <div className="field">
          <textarea
            className="textarea"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What's worth noting?"
          />
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!body.trim()}
            onClick={() => void save()}
          >
            Save note
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
