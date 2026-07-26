import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { ManualCheckinDialog } from "./ManualCheckinDialog";

// Checklists & Tours — Tour Progress View (see pages/tour-progress.html).
// Security-only. Progress is derived from the current guard's own check-ins
// timestamped within their current Shift window — a new shift starts every
// tour fresh, with no separate "reset" action.
export function TourProgressPage() {
  const { tourId } = useParams();
  const current = useCurrent();
  const userId = current.user?.id;
  const [manualCheckin, setManualCheckin] = useState(false);

  const { data } = db.useQuery(
    tourId ? { tours: { $: { where: { id: tourId } }, checkpoints: { location: {} } } } : null,
  );
  const tour = data?.tours?.[0];

  const { data: shiftData } = db.useQuery(
    userId
      ? { shifts: { $: { where: { "guard.id": userId, endedAt: { $isNull: true } } } } }
      : null,
  );
  const activeShift = shiftData?.shifts?.[0];

  const checkpointIds = (tour?.checkpoints ?? []).map((c) => c.id);
  const { data: checkInData } = db.useQuery(
    userId && activeShift && checkpointIds.length > 0
      ? {
          checkIns: {
            $: {
              where: {
                "user.id": userId,
                "checkpoint.id": { $in: checkpointIds },
                timestamp: { $gt: new Date(activeShift.startedAt) },
              },
            },
          },
        }
      : null,
  );
  const visitedIds = new Set(
    (checkInData?.checkIns ?? []).map((c) => (c as { checkpoint?: { id: string } }).checkpoint?.id),
  );

  if (!tour) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const checkpointsById = new Map((tour.checkpoints ?? []).map((c) => [c.id, c]));

  if (!activeShift) {
    return (
      <div>
        <div className="page-head">
          <h1 className="page-title">
            {tour.name} <span className="badge badge-accent">Security</span>
          </h1>
        </div>
        <div className="placeholder">
          <div className="big">No active tour</div>
          Start a shift from the Dashboard to begin tracking progress.
          <div style={{ marginTop: 10 }}>
            <Link to="/checklists" className="btn btn-sm">
              ← Back to Checklists
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">
          {tour.name} <span className="badge badge-accent">Security</span>
        </h1>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setManualCheckin(true)}
        >
          Check in manually
        </button>
      </div>
      <div className="badge" style={{ marginBottom: 10 }}>
        {modeLabel(tour.mode)}
      </div>

      {manualCheckin && (
        <ManualCheckinDialog onClose={() => setManualCheckin(false)} />
      )}

      {tour.mode === "linear" && (
        <LinearProgress
          checkpointsById={checkpointsById}
          order={tour.checkpointOrder ?? []}
          visitedIds={visitedIds}
        />
      )}
      {tour.mode === "freeform" && (
        <FreeformProgress checkpoints={tour.checkpoints ?? []} visitedIds={visitedIds} />
      )}
      {tour.mode === "randomized" && (
        <RandomizedProgress
          tourId={tour.id}
          shiftId={activeShift.id}
          checkpoints={tour.checkpoints ?? []}
          visitedIds={visitedIds}
        />
      )}
    </div>
  );
}

function modeLabel(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

type Checkpoint = { id: string; name: string };

function LinearProgress({
  checkpointsById,
  order,
  visitedIds,
}: {
  checkpointsById: Map<string, Checkpoint>;
  order: string[];
  visitedIds: Set<string | undefined>;
}) {
  const ids = order.length > 0 ? order : [...checkpointsById.keys()];
  const nextIndex = ids.findIndex((id) => !visitedIds.has(id));
  return (
    <table className="table">
      <thead>
        <tr>
          <th></th>
          <th>Checkpoint</th>
        </tr>
      </thead>
      <tbody>
        {ids.map((cpId, i) => {
          const cp = checkpointsById.get(cpId);
          if (!cp) return null;
          const visited = visitedIds.has(cpId);
          const isNext = i === nextIndex;
          return (
            <tr key={cpId}>
              <td>{visited ? <span className="badge badge-good">✓</span> : isNext ? "→" : ""}</td>
              <td>
                <Link to={`/locations/checkpoints/${cpId}`}>
                  {isNext ? <strong>{cp.name} (next)</strong> : cp.name}
                </Link>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FreeformProgress({
  checkpoints,
  visitedIds,
}: {
  checkpoints: Checkpoint[];
  visitedIds: Set<string | undefined>;
}) {
  return (
    <div className="stack">
      {checkpoints.map((cp) => (
        <Link
          key={cp.id}
          to={`/locations/checkpoints/${cp.id}`}
          className="card spread"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <span className="card-title">{cp.name}</span>
          <span className={"badge" + (visitedIds.has(cp.id) ? " badge-good" : "")}>
            {visitedIds.has(cp.id) ? "Visited" : "Remaining"}
          </span>
        </Link>
      ))}
    </div>
  );
}

// Randomized mode deliberately withholds the full remaining route — only the
// next available checkpoint(s) are surfaced, chosen deterministically from
// how many stops into this shift's round the guard is, so the pick is stable
// across reloads without ever exposing the rest of the set.
function RandomizedProgress({
  tourId,
  shiftId,
  checkpoints,
  visitedIds,
}: {
  tourId: string;
  shiftId: string;
  checkpoints: Checkpoint[];
  visitedIds: Set<string | undefined>;
}) {
  const unvisited = checkpoints.filter((cp) => !visitedIds.has(cp.id));
  if (unvisited.length === 0) {
    return (
      <div className="placeholder">
        <div className="big">All checkpoints visited this shift</div>
      </div>
    );
  }
  const idx = hashIndex(`${tourId}:${shiftId}:${visitedIds.size}`, unvisited.length);
  const next = unvisited[idx];
  return (
    <div>
      <p className="muted small">
        Only the next available checkpoint is shown — not the full remaining set — so patrol
        patterns stay unpredictable.
      </p>
      <div className="card">
        <div className="card-meta">NEXT CHECKPOINT</div>
        <div className="card-title">{next.name}</div>
        <div className="row" style={{ marginTop: 8 }}>
          <Link to={`/locations/checkpoints/${next.id}`} className="btn btn-sm">
            View checkpoint
          </Link>
        </div>
      </div>
      <div className="card-meta" style={{ marginTop: 8 }}>
        {unvisited.length} checkpoint{unvisited.length === 1 ? "" : "s"} remaining (count only)
      </div>
    </div>
  );
}

function hashIndex(seed: string, mod: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % mod;
}
