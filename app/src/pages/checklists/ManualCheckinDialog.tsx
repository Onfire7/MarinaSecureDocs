import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../lib/db";
import { useCheckpointVisit } from "./useCheckpointVisit";

// Checklists & Tours — Manual Check-In Dialog (see pages/manual-checkin-dialog.html).
// Fallback when a checkpoint's NFC tag/QR is unreadable. Reason is the one
// hard validation rule; GPS is still captured in the background exactly as
// on the scanned flow.
export function ManualCheckinDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [checkpointId, setCheckpointId] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data } = db.useQuery({ checkpoints: { location: {} } });
  const checkpoints = data?.checkpoints ?? [];

  const visit = useCheckpointVisit(
    submitted ? checkpointId : undefined,
    "manual",
    reason,
    undefined,
  );

  const open = (id: string) => {
    onClose();
    navigate(`/checklists/${id}`);
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Manual Check-In
        </div>

        {!submitted ? (
          <>
            <div className="field">
              <span className="field-label">Checkpoint</span>
              <select
                className="select"
                value={checkpointId}
                onChange={(e) => setCheckpointId(e.target.value)}
              >
                <option value="">Select…</option>
                {checkpoints.map((cp) => (
                  <option key={cp.id} value={cp.id}>
                    {cp.name}
                    {cp.location?.name ? ` — ${cp.location.name}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <span className="field-label">Reason — required</span>
              <textarea
                className="textarea"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. NFC tag damaged, scanning QR sticker instead"
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!checkpointId || !reason.trim()}
                onClick={() => setSubmitted(true)}
              >
                Submit
              </button>
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : visit.loading || !visit.checkInId ? (
          <div className="muted">Logging check-in…</div>
        ) : visit.applicableChecklists.length === 0 ? (
          <>
            <p className="muted small">Check-in logged. Nothing currently applies here.</p>
            <button type="button" className="btn" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <p className="muted small">Check-in logged.</p>
            <div className="stack">
              {visit.applicableChecklists.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="btn btn-block"
                  onClick={() => open(c.id)}
                >
                  {c.templateName}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
