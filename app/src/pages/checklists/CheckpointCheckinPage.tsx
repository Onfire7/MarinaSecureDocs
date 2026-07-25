import { useEffect, useRef } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@clerk/clerk-react";
import { db } from "../../lib/db";
import { useCheckpointVisit } from "./useCheckpointVisit";

const IDLE_TIMEOUT_MS = 10 * 60_000;

// Checklists & Tours — Checkpoint Check-In (see pages/checkpoint-checkin.html).
// What a checkpoint's NFC/QR guid_url opens. Sits outside the normal
// authenticated route tree since it's a public deep link — an unauthenticated
// visit detours through Sign In / User Switch and resumes here afterward.
export function CheckpointCheckinPage() {
  const { guidUrl } = useParams();
  const { isLoaded, isSignedIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const resumeCheckInId = searchParams.get("checkin") ?? undefined;

  const { data, isLoading: cpLoading } = db.useQuery(
    guidUrl && isSignedIn
      ? { checkpoints: { $: { where: { guidUrl } }, location: {} } }
      : null,
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

  if (!isLoaded) return null;

  if (!isSignedIn) {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    return <Navigate to={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (!guidUrl) return null;

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

  return (
    <div>
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
        <div className="stack">
          {visit.applicableChecklists.map((c) => (
            <div key={c.id} className="card">
              <div className="card-title">{c.templateName}</div>
              <div className="card-meta">
                {c.status === "complete"
                  ? "Complete"
                  : c.status === "in_progress"
                    ? "In Progress"
                    : "Not Started"}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <Link to={`/checklists/${c.id}`} className="btn btn-primary btn-sm">
                  {c.status === "not_started" ? "Begin Checklist" : "Resume Checklist"}
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GpsPill({ status }: { status: "pending" | "clear" | "outside_radius" | "unavailable" }) {
  if (status === "clear") return null;
  if (status === "pending") return <span className="badge">Saving…</span>;
  if (status === "outside_radius") return <span className="badge badge-bad">Outside radius</span>;
  return <span className="badge">Location unavailable</span>;
}

// Closes this tab once nothing is left unfinished — or, if the app isn't
// installed and the browser refuses to close a tab it didn't itself open,
// falls back to redirecting to the Dashboard and keeps retrying the close on
// every subsequent focus (see spec: "Tab pileup").
function useCloseWhenDone(done: boolean) {
  const navigate = useNavigate();
  const doneRef = useRef(done);
  doneRef.current = done;
  const attempted = useRef(false);

  useEffect(() => {
    if (!done || attempted.current) return;
    attempted.current = true;
    window.close();
    navigate("/", { replace: true });
  }, [done, navigate]);

  useEffect(() => {
    const retry = () => {
      if (doneRef.current) window.close();
    };
    document.addEventListener("visibilitychange", retry);
    window.addEventListener("focus", retry);
    const idle = setTimeout(() => {
      if (doneRef.current) window.close();
    }, IDLE_TIMEOUT_MS);
    return () => {
      document.removeEventListener("visibilitychange", retry);
      window.removeEventListener("focus", retry);
      clearTimeout(idle);
    };
  }, []);
}
