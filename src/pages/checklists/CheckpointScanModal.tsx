import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import type { AttachmentTarget } from "../../lib/attachments";
import { NoteDialog } from "../shared/NoteDialog";
import { useCheckpointVisit } from "./useCheckpointVisit";
import { CheckpointCheckinView } from "./CheckpointCheckinPage";

/**
 * What a checkpoint tag scanned by NfcScanToggle opens — a full-screen
 * overlay with no app chrome (no sidenav/tabbar), not a route change.
 *
 * Deliberately not `navigate("/checkin/:guidUrl")`: the guard might be
 * mid-checklist-item somewhere else in the app, and swapping the whole
 * screen out from under them would lose whatever they hadn't saved yet.
 * This sits on top instead, and (via CheckpointCheckinView embedding
 * ChecklistItemsPanel) the checklist's items are usable right here — a
 * checkpoint almost always has exactly one, so there's no extra tap through
 * a "Begin Checklist" link either. Closing just dismisses the overlay;
 * whatever was underneath is exactly as it was. Raising an Incident is the
 * one action that still navigates away — that's a deliberate bigger
 * workflow, not something to cram into the overlay.
 */
export function CheckpointScanModal({
  guidUrl,
  onClose,
}: {
  guidUrl: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const current = useCurrent();
  const [showNoteDialog, setShowNoteDialog] = useState(false);

  const { data, isLoading: cpLoading } = db.useQuery({
    checkpoints: { $: { where: { guidUrl } }, location: {} },
  });
  const checkpoint = data?.checkpoints?.[0];

  // No resumeCheckInId to pass — useCheckpointVisit's own dedupe window
  // finds a just-created check-in at this checkpoint on its own, so
  // re-scanning the same tag within 5 minutes resumes rather than
  // duplicates, same as reloading the full-page version would.
  const visit = useCheckpointVisit(checkpoint?.id, "scanned", undefined, undefined);

  const target: AttachmentTarget | null = checkpoint
    ? { type: "checkpoint", id: checkpoint.id, label: checkpoint.name }
    : null;

  return (
    <div className="scan-modal">
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          ✕ Close
        </button>
      </div>

      {cpLoading && <div className="muted" style={{ marginTop: 16 }}>Loading checkpoint…</div>}

      {!cpLoading && !checkpoint && (
        <div className="placeholder">
          <div className="big">Checkpoint not found</div>
          This check-in link doesn't match a known checkpoint.
        </div>
      )}

      {checkpoint && target && (
        <div style={{ marginTop: 8 }}>
          <CheckpointCheckinView
            checkpoint={checkpoint}
            visit={visit}
            canCreateIncidents={current.can("create_incidents")}
            onNote={() => setShowNoteDialog(true)}
            onIncident={() => {
              onClose();
              navigate("/incidents/new", { state: { target } });
            }}
          />
          {showNoteDialog && (
            <NoteDialog target={target} onClose={() => setShowNoteDialog(false)} />
          )}
        </div>
      )}
    </div>
  );
}
