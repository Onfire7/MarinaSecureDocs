import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["shared", "common"]);
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
          {t("note.title", { target: target.label })}
        </div>
        <div className="field">
          <textarea
            className="textarea"
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("note.placeholder")}
          />
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!body.trim()}
            onClick={() => void save()}
          >
            {t("note.save")}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {t("common:cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
