import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import type { AttachmentTarget } from "../../lib/attachments";
import { NoteDialog } from "../shared/NoteDialog";
import { useCheckpointVisit } from "./useCheckpointVisit";
import { ChecklistItemsPanel } from "./ActiveChecklistPage";

const IDLE_TIMEOUT_MS = 10 * 60_000;

// Checklists & Tours — Checkpoint Check-In (see pages/checkpoint-checkin.html).
// What a checkpoint's NFC/QR guid_url opens. CheckinRoute in App.tsx has
// already established the Clerk session and the current-user context by the
// time this renders — an unauthenticated scan detours through Sign In there
// and resumes here afterward.
//
// A checkpoint scanned by NfcScanToggle while the app is already open takes
// a different path entirely (CheckpointScanModal, a chrome-less overlay) —
// this page is specifically what a *fresh* scan-launched tab lands on, which
// is why window-close/idle-timeout behavior below only makes sense here.
export function CheckpointCheckinPage() {
  const { guidUrl } = useParams();
  const navigate = useNavigate();
  const current = useCurrent();
  const [searchParams] = useSearchParams();
  const resumeCheckInId = searchParams.get("checkin") ?? undefined;
  const [showNoteDialog, setShowNoteDialog] = useState(false);

  const { data, isLoading: cpLoading } = db.useQuery(
    guidUrl ? { checkpoints: { $: { where: { guidUrl } }, location: {} } } : null,
  );
  const checkpoint = data?.checkpoints?.[0];

  const visit = useCheckpointVisit(
    checkpoint?.id,
    "scanned",
    undefined,
    resumeCheckInId,
  );

  // Rewrite the URL to include the Check-In id right after creation, without
  // a full navigation — a reload of this same tab then resumes instead of
  // duplicating (see spec: "Avoiding duplicate check-ins & tab pileup").
  useEffect(() => {
    if (visit.checkInId && !resumeCheckInId) {
      window.history.replaceState(null, "", `?checkin=${visit.checkInId}`);
    }
  }, [visit.checkInId, resumeCheckInId]);

  const done = visit.allTriggeredComplete || visit.hasNoApplicable;
  useCloseWhenDone(done);

  if (cpLoading) {
    return (
      <div className="auth-screen">
        <div className="muted">Loading checkpoint…</div>
      </div>
    );
  }

  if (!checkpoint) {
    return (
      <div className="auth-screen">
        <div className="auth-brand">
          <div className="marina-name">Checkpoint not found</div>
        </div>
        <p className="muted small">This check-in link doesn't match a known checkpoint.</p>
        <button type="button" className="btn" onClick={() => navigate("/")}>
          Go to Dashboard
        </button>
      </div>
    );
  }

  const target: AttachmentTarget = {
    type: "checkpoint",
    id: checkpoint.id,
    label: checkpoint.name,
  };

  return (
    <div>
      <CheckpointCheckinView
        checkpoint={checkpoint}
        visit={visit}
        canCreateIncidents={current.can("create_incidents")}
        onNote={() => setShowNoteDialog(true)}
        onIncident={() => navigate("/incidents/new", { state: { target } })}
      />

      {showNoteDialog && (
        <NoteDialog target={target} onClose={() => setShowNoteDialog(false)} />
      )}
    </div>
  );
}

/**
 * The checkpoint-visit UI itself, with no opinion on how it's framed — used
 * both by the full page above (fresh scan-launched tab) and by
 * CheckpointScanModal (a tag scanned while the app's already open). Pure
 * presentation: all data comes in as props, all actions go out as callbacks.
 */
export function CheckpointCheckinView({
  checkpoint,
  visit,
  canCreateIncidents,
  onNote,
  onIncident,
}: {
  checkpoint: { id: string; name: string; location?: { name: string } | null };
  visit: ReturnType<typeof useCheckpointVisit>;
  canCreateIncidents: boolean;
  onNote: () => void;
  onIncident: () => void;
}) {
  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{checkpoint.name}</h1>
        <GpsPill status={visit.gpsStatus} />
      </div>
      <div className="page-sub">{checkpoint.location?.name}</div>

      <div className="section-title" style={{ marginTop: 16 }}>
        Applicable now
      </div>
      {visit.applicableChecklists.length === 0 ? (
        <div className="placeholder">
          <div className="big">Nothing triggers right now</div>
          No checklist currently applies at this checkpoint.
        </div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {/* Almost always exactly one — shown ready to work right here
              rather than behind an extra "Begin Checklist" tap. */}
          {visit.applicableChecklists.map((c) => (
            <div key={c.id} className="card">
              <ChecklistItemsPanel checklistId={c.id} compact />
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="btn btn-sm" onClick={onNote}>
          + Note
        </button>
        {canCreateIncidents && (
          <button type="button" className="btn btn-sm" onClick={onIncident}>
            + Incident
          </button>
        )}
      </div>
    </>
  );
}

function GpsPill({ status }: { status: "pending" | "clear" | "outside_radius" | "unavailable" }) {
  if (status === "clear") return null;
  if (status === "pending") return <span className="badge">Saving…</span>;
  if (status === "outside_radius") return <span className="badge badge-bad">Outside radius</span>;
  return <span className="badge">Location unavailable</span>;
}

// Closes this tab once nothing is left unfinished. window.close() only
// works on a tab the script itself opened, which a scan-launched tab
// usually isn't — that failure is silent (no return value, no event), so
// the immediate attempt below must NOT also redirect: the guard needs the
// chance to actually see this screen (and use the note/incident actions on
// it) before anything whisks them away. Redirecting to the Dashboard is
// reserved for the "never revisited" fallback — the idle timeout — so a tab
// left open in the background at least shows something current rather than
// a dead checkpoint screen (see spec: "Tab pileup").
function useCloseWhenDone(done: boolean) {
  const navigate = useNavigate();
  const doneRef = useRef(done);
  doneRef.current = done;
  const attempted = useRef(false);

  useEffect(() => {
    if (!done || attempted.current) return;
    attempted.current = true;
    window.close();
  }, [done]);

  useEffect(() => {
    const retry = () => {
      if (doneRef.current) window.close();
    };
    document.addEventListener("visibilitychange", retry);
    window.addEventListener("focus", retry);
    const idle = setTimeout(() => {
      if (doneRef.current) {
        window.close();
        navigate("/", { replace: true });
      }
    }, IDLE_TIMEOUT_MS);
    return () => {
      document.removeEventListener("visibilitychange", retry);
      window.removeEventListener("focus", retry);
      clearTimeout(idle);
    };
  }, [navigate]);
}
