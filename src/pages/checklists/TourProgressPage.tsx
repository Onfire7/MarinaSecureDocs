import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { groupByLocation } from "../../lib/checkpoints";
import { ManualCheckinDialog } from "./ManualCheckinDialog";
import { useShiftVisits } from "./useShiftVisits";

// Checklists & Tours — Tour Progress View (see pages/tour-progress.html).
// Security-only. Progress is derived from the current guard's own check-ins
// timestamped within their current Shift window — a new shift starts every
// tour fresh, with no separate "reset" action.
//
// Work-first ordering: what's still to visit leads the page, and visited
// checkpoints drop into one collapsed section at the bottom. Mid-round, the
// visited list only grows — interleaving it with the remaining stops meant
// the round's actual state was buried deeper with every scan.
export function TourProgressPage() {
  const { tourId } = useParams();
  const [manualCheckin, setManualCheckin] = useState(false);

  const { data } = db.useQuery(
    tourId ? { tours: { $: { where: { id: tourId } }, checkpoints: { location: {} } } } : null,
  );
  const tour = data?.tours?.[0];
  const { activeShift, visitedIds } = useShiftVisits();

  if (!tour) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const checkpoints = tour.checkpoints ?? [];
  const visited = checkpoints.filter((c) => visitedIds.has(c.id));
  const remaining = checkpoints.filter((c) => !visitedIds.has(c.id));

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
      <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
        <span className="badge">{modeLabel(tour.mode)}</span>
        <span className={"badge" + (remaining.length === 0 ? " badge-good" : " badge-warn")}>
          {remaining.length === 0
            ? "All visited this shift ✓"
            : `${remaining.length} of ${checkpoints.length} remaining`}
        </span>
      </div>
      {checkpoints.length > 0 && (
        <div className="progress-track" style={{ marginBottom: 14 }}>
          <div
            className="progress-fill"
            style={{ width: `${(visited.length / checkpoints.length) * 100}%` }}
          />
        </div>
      )}

      {manualCheckin && (
        <ManualCheckinDialog onClose={() => setManualCheckin(false)} />
      )}

      {tour.mode === "linear" && (
        <LinearRemaining
          checkpoints={checkpoints}
          order={tour.checkpointOrder ?? []}
          visitedIds={visitedIds}
        />
      )}
      {tour.mode === "freeform" && (
        <FreeformRemaining remaining={remaining} />
      )}
      {tour.mode === "randomized" && (
        <RandomizedNext
          tourId={tour.id}
          shiftId={activeShift.id}
          remaining={remaining}
          visitedCount={visited.length}
        />
      )}

      {visited.length > 0 && (
        <details className="section-collapse" style={{ marginTop: 16 }}>
          <summary>
            <span className="section-title" style={{ marginBottom: 0 }}>
              Visited this shift · {visited.length}
            </span>
          </summary>
          <div className="stack" style={{ gap: 4, marginTop: 8 }}>
            {groupByLocation(visited).map((g) => (
              <div key={g.locationId || "none"}>
                <div className="group-heading">
                  <span>{g.label}</span>
                </div>
                {g.items.map((cp) => (
                  <Link
                    key={cp.id}
                    to={`/locations/checkpoints/${cp.id}`}
                    className="spread muted small"
                    style={{ textDecoration: "none", padding: "4px 0" }}
                  >
                    <span>{cp.name}</span>
                    <span className="badge badge-good">✓</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function modeLabel(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

type Checkpoint = {
  id: string;
  name: string;
  location?: { id: string; name: string } | null;
};

// The next stop is a hero card — mid-round the only question is "where to
// now?" — with the rest of the route listed in order beneath it. Visited
// rows aren't shown here at all; they live in the shared collapsed section.
function LinearRemaining({
  checkpoints,
  order,
  visitedIds,
}: {
  checkpoints: Checkpoint[];
  order: string[];
  visitedIds: Set<string>;
}) {
  const byId = new Map(checkpoints.map((c) => [c.id, c]));
  const ids = order.length > 0 ? order : checkpoints.map((c) => c.id);
  const remainingIds = ids.filter((cpId) => byId.has(cpId) && !visitedIds.has(cpId));

  if (remainingIds.length === 0) {
    return (
      <div className="placeholder">
        <div className="big">Route complete</div>
        Every checkpoint on this tour has been visited this shift.
      </div>
    );
  }

  const [nextId, ...upcoming] = remainingIds;
  const next = byId.get(nextId)!;

  return (
    <div>
      <Link
        to={`/locations/checkpoints/${next.id}`}
        className="card"
        style={{ display: "block", textDecoration: "none", color: "inherit" }}
      >
        <div className="card-meta">NEXT — STOP {ids.indexOf(nextId) + 1} OF {ids.length}</div>
        <div className="card-title" style={{ fontSize: "1.2rem" }}>
          {next.name}
        </div>
        {next.location?.name && (
          <div className="muted small">{next.location.name}</div>
        )}
      </Link>

      {upcoming.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 12 }}>
            Then
          </div>
          <div className="stack" style={{ gap: 4 }}>
            {upcoming.map((cpId) => {
              const cp = byId.get(cpId)!;
              return (
                <Link
                  key={cpId}
                  to={`/locations/checkpoints/${cpId}`}
                  className="card spread"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <span className="small">
                    <span className="muted">{ids.indexOf(cpId) + 1}. </span>
                    {cp.name}
                    {cp.location?.name && (
                      <span className="muted"> · {cp.location.name}</span>
                    )}
                  </span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function FreeformRemaining({ remaining }: { remaining: Checkpoint[] }) {
  if (remaining.length === 0) {
    return (
      <div className="placeholder">
        <div className="big">Round complete</div>
        Every checkpoint on this tour has been visited this shift.
      </div>
    );
  }
  // Freeform imposes no sequence, so the remaining stops group by location —
  // which is also how a guard works a round: finish this dock, move on.
  return (
    <div>
      {groupByLocation(remaining).map((g) => (
        <div key={g.locationId || "none"}>
          <div className="group-heading">
            <span>{g.label}</span>
            <span>{g.items.length}</span>
          </div>
          <div className="stack">
            {g.items.map((cp) => (
              <Link
                key={cp.id}
                to={`/locations/checkpoints/${cp.id}`}
                className="card spread"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <span className="card-title">{cp.name}</span>
                <span className="badge">Remaining</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Randomized mode deliberately withholds the full remaining route — only the
// next available checkpoint is surfaced, chosen deterministically from how
// many stops into this shift's round the guard is, so the pick is stable
// across reloads without ever exposing the rest of the set.
function RandomizedNext({
  tourId,
  shiftId,
  remaining,
  visitedCount,
}: {
  tourId: string;
  shiftId: string;
  remaining: Checkpoint[];
  visitedCount: number;
}) {
  if (remaining.length === 0) {
    return (
      <div className="placeholder">
        <div className="big">All checkpoints visited this shift</div>
      </div>
    );
  }
  const idx = hashIndex(`${tourId}:${shiftId}:${visitedCount}`, remaining.length);
  const next = remaining[idx];
  return (
    <div>
      <div className="card">
        <div className="card-meta">NEXT CHECKPOINT</div>
        <div className="card-title" style={{ fontSize: "1.2rem" }}>{next.name}</div>
        {next.location?.name && (
          <div className="muted small">{next.location.name}</div>
        )}
        <div className="row" style={{ marginTop: 8 }}>
          <Link to={`/locations/checkpoints/${next.id}`} className="btn btn-sm">
            View checkpoint
          </Link>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        Only the next checkpoint is shown — {remaining.length} remaining in
        total — so patrol patterns stay unpredictable.
      </p>
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
