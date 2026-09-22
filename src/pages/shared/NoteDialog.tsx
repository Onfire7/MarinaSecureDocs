import { useState } from "react";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import type { AttachmentTarget } from "../../data/attachments";
import { createNote } from "../../data/notes";

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
    await createNote(body.trim(), target, current.user?.id ?? null);
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
