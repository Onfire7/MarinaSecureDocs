import { Link } from "react-router-dom";
import { groupByLocation } from "../../lib/checkpoints";

// Checklists & Tours — the per-tour section rendered inline on the Checklist
// list (see pages/checklist-list.html and pages/tour-progress.html). A guard
// typically has exactly one active tour, so its steps live directly on the
// work-queue page under a small heading rather than behind a navigation hop.
//
// Same work-first rule as the rest of the page, expressed per mode: freeform
// shows every checkpoint as a status-colored button inside its location's
// container (visited green, remaining neutral); linear and randomized hide
// visited stops from their sequence view and drop them into a collapsed
// disclosure instead. Progress derives from the guard's own check-ins within
// the current shift.

export type TourCheckpoint = {
  id: string;
  name: string;
  location_id?: string | null;
  location_name?: string | null;
  /** Its place in the tour. Ordering is a column now, not a json array. */
  position?: number;
};

export type TourRow = {
  id: string;
  name: string;
  mode: string;
};

export function TourSection({
  tour,
  checkpoints,
  shiftId,
  visitedIds,
}: {
  tour: TourRow;
  /** Already in tour order — tour_checkpoints.position, not a stored array. */
  checkpoints: TourCheckpoint[];
  /** Absent when no shift is active — steps still show, progress doesn't. */
  shiftId: string | undefined;
  visitedIds: Set<string>;
}) {
  const visited = shiftId ? checkpoints.filter((c) => visitedIds.has(c.id)) : [];
  const remaining = shiftId
    ? checkpoints.filter((c) => !visitedIds.has(c.id))
    : checkpoints;
  const done = shiftId && checkpoints.length > 0 && remaining.length === 0;

  return (
    <section style={done ? { opacity: 0.65 } : undefined}>
      <div className="group-heading">
        <span>
          {tour.name}
          <span className="muted"> · {modeLabel(tour.mode)}</span>
        </span>
        {shiftId && checkpoints.length > 0 && (
          <span className={"badge" + (done ? " badge-good" : " badge-warn")}>
            {done ? "Complete ✓" : `${remaining.length} of ${checkpoints.length} left`}
          </span>
        )}
      </div>

      {shiftId && checkpoints.length > 0 && (
        <div className="progress-track" style={{ marginBottom: 10 }}>
          <div
            className="progress-fill"
            style={{ width: `${(visited.length / checkpoints.length) * 100}%` }}
          />
        </div>
      )}

      {tour.mode === "linear" && (
        <LinearRemaining
          checkpoints={checkpoints}
          visitedIds={shiftId ? visitedIds : new Set()}
        />
      )}
      {tour.mode === "freeform" && (
        <FreeformCheckpoints
          checkpoints={checkpoints}
          visitedIds={shiftId ? visitedIds : new Set()}
          tracking={Boolean(shiftId)}
        />
      )}
      {tour.mode === "randomized" && (
        <RandomizedNext
          tourId={tour.id}
          shiftId={shiftId}
          remaining={remaining}
          visitedCount={visited.length}
        />
      )}

      {tour.mode !== "freeform" && visited.length > 0 && (
        <details className="section-collapse" style={{ marginTop: 10 }}>
          <summary>
            <span className="small" style={{ fontWeight: 650 }}>
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
    </section>
  );
}

function modeLabel(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

// The next stop is a hero card — mid-round the only question is "where to
// now?" — with the rest of the route listed in order beneath it. Visited
// rows aren't shown here at all; they live in the shared collapsed section.
function LinearRemaining({
  checkpoints,
  visitedIds,
}: {
  checkpoints: TourCheckpoint[];
  visitedIds: Set<string>;
}) {
  const byId = new Map(checkpoints.map((c) => [c.id, c]));
  const ids = checkpoints.map((c) => c.id);
  const remainingIds = ids.filter((cpId) => !visitedIds.has(cpId));

  if (remainingIds.length === 0) {
    return (
      <p className="muted small">
        Route complete — every checkpoint visited this shift.
      </p>
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
        <div className="card-meta">
          NEXT — STOP {ids.indexOf(nextId) + 1} OF {ids.length}
        </div>
        <div className="card-title" style={{ fontSize: "1.2rem" }}>
          {next.name}
        </div>
        {next.location_name && (
          <div className="muted small">{next.location_name}</div>
        )}
      </Link>

      {upcoming.length > 0 && (
        <div className="stack" style={{ gap: 4, marginTop: 8 }}>
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
                  {cp.location_name && (
                    <span className="muted"> · {cp.location_name}</span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

// One container per location, its checkpoints as buttons color-coded by
// this-shift status — visited green, remaining neutral. Freeform imposes no
// sequence, so the location is the unit a guard works in ("finish this dock,
// move on"), and color carries the done/left split without hiding either.
// Locations still fully unvisited sort first; finished ones sink and dim.
function FreeformCheckpoints({
  checkpoints,
  visitedIds,
  tracking,
}: {
  checkpoints: TourCheckpoint[];
  visitedIds: Set<string>;
  tracking: boolean;
}) {
  if (checkpoints.length === 0) {
    return <p className="muted small">No checkpoints on this tour yet.</p>;
  }
  const groups = groupByLocation(checkpoints)
    .map((g) => {
      const left = g.items.filter((c) => !visitedIds.has(c.id)).length;
      return { ...g, left };
    })
    .sort((a, b) => (a.left === 0 ? 1 : 0) - (b.left === 0 ? 1 : 0));

  return (
    <div className="stack" style={{ gap: 8 }}>
      {groups.map((g) => {
        const done = tracking && g.left === 0;
        return (
          <div
            key={g.locationId || "none"}
            className="card"
            style={done ? { opacity: 0.65 } : undefined}
          >
            <div className="spread" style={{ marginBottom: 8 }}>
              <span className="card-title">{g.label}</span>
              {tracking && (
                <span className={"small " + (done ? "" : "muted")}>
                  {done ? (
                    <span className="badge badge-good">✓</span>
                  ) : (
                    `${g.items.length - g.left}/${g.items.length}`
                  )}
                </span>
              )}
            </div>
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {g.items.map((cp) => {
                const visited = tracking && visitedIds.has(cp.id);
                return (
                  <Link
                    key={cp.id}
                    to={`/locations/checkpoints/${cp.id}`}
                    className={"cp-btn" + (visited ? " cp-btn-visited" : "")}
                  >
                    {visited && "✓ "}
                    {cp.name}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
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
  shiftId: string | undefined;
  remaining: TourCheckpoint[];
  visitedCount: number;
}) {
  if (!shiftId) {
    return (
      <p className="muted small">
        {remaining.length} checkpoint{remaining.length === 1 ? "" : "s"} — the
        next one is revealed once a shift is active.
      </p>
    );
  }
  if (remaining.length === 0) {
    return (
      <p className="muted small">All checkpoints visited this shift.</p>
    );
  }
  const idx = hashIndex(`${tourId}:${shiftId}:${visitedCount}`, remaining.length);
  const next = remaining[idx];
  return (
    <div>
      <Link
        to={`/locations/checkpoints/${next.id}`}
        className="card"
        style={{ display: "block", textDecoration: "none", color: "inherit" }}
      >
        <div className="card-meta">NEXT CHECKPOINT</div>
        <div className="card-title" style={{ fontSize: "1.2rem" }}>{next.name}</div>
        {next.location_name && (
          <div className="muted small">{next.location_name}</div>
        )}
      </Link>
      <p className="muted small" style={{ marginTop: 6 }}>
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
