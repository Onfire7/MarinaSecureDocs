import { useMemo, useState } from "react";
import { db, id } from "../../lib/db";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";
import { MultiSelectDialog } from "../shared/MultiSelectDialog";
import { ReorderableList } from "../shared/ReorderableList";
import { DraftInput } from "../shared/DraftInput";
import { groupByLocation, locationPathResolver } from "../../lib/checkpoints";

// Admin — Tours Setup (see docs/pages/admin-tours.html).
// Gated by manage_locations rather than a dedicated permission, since a tour
// is fundamentally a composition of checkpoints. This screen never creates
// checkpoints — only assembles existing ones.
export function AdminToursPage() {
  return (
    <AdminGate requires="manage_locations">
      <Tours />
    </AdminGate>
  );
}

const MODES = ["linear", "freeform", "randomized"] as const;

function Tours() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const { data } = db.useQuery({
    tours: { checkpoints: { location: {} } },
    checkpoints: { location: {} },
    // Ancestor paths for group labels — a bare location name can repeat
    // between docks, which is the ambiguity grouping exists to remove.
    locations: { parent: {} },
  });
  const tours = useMemo(
    () => [...(data?.tours ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  const allCheckpoints = useMemo(
    () =>
      [...(data?.checkpoints ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      ),
    [data],
  );
  const pathOf = useMemo(
    () => locationPathResolver(data?.locations ?? []),
    [data],
  );

  // Named inline rather than through a prompt dialog, matching how Location
  // Types are added — one box, one button, no modal to dismiss.
  const addTour = async () => {
    if (!newName.trim()) return;
    const tourId = id();
    await db.transact(
      db.tx.tours[tourId].update({ name: newName.trim(), mode: "freeform" }),
    );
    setNewName("");
    setExpanded(tourId);
  };

  return (
    <div>
      <AdminHeader title="Tours">
        <div className="row">
          <input
            className="input select-inline"
            style={{ minWidth: 180 }}
            placeholder="New tour name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void addTour();
            }}
          />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!newName.trim()}
            onClick={() => void addTour()}
          >
            + Add tour
          </button>
        </div>
      </AdminHeader>

      {allCheckpoints.length === 0 && (
        <div className="badge badge-warn" style={{ display: "block", marginBottom: 12 }}>
          No checkpoints exist yet — create them in Checkpoints (or from
          Location Types & Locations) before assembling a tour.
        </div>
      )}

      <div className="stack" style={{ gap: 8 }}>
        {tours.map((t) => (
          <TourCard
            key={t.id}
            tour={t}
            allCheckpoints={allCheckpoints}
            pathOf={pathOf}
            expanded={expanded === t.id}
            onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
            onDuplicated={setExpanded}
          />
        ))}
        {tours.length === 0 && (
          <div className="placeholder">
            <div className="big">No tours defined</div>
          </div>
        )}
      </div>
    </div>
  );
}

type TourRow = {
  id: string;
  name: string;
  mode: string;
  /** Null once a tour has left linear mode — see setMode. */
  checkpointOrder?: string[] | null;
  checkpoints?: { id: string; name: string; location?: { id: string; name: string } | null }[];
};

function TourCard({
  tour,
  allCheckpoints,
  pathOf,
  expanded,
  onToggle,
  onDuplicated,
}: {
  tour: TourRow;
  allCheckpoints: { id: string; name: string; location?: { id: string; name: string } | null }[];
  pathOf: (locationId: string) => string;
  expanded: boolean;
  onToggle: () => void;
  onDuplicated: (tourId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const members = useMemo(() => tour.checkpoints ?? [], [tour.checkpoints]);
  const memberIds = new Set(members.map((c) => c.id));

  // Linear mode carries an explicit order; the others are a plain set.
  const ordered = useMemo(() => {
    const order = tour.checkpointOrder ?? [];
    const byId = new Map(members.map((c) => [c.id, c]));
    const inOrder = order.map((cid) => byId.get(cid)).filter(Boolean) as typeof members;
    const rest = members.filter((c) => !order.includes(c.id));
    return [...inOrder, ...rest];
  }, [tour.checkpointOrder, members]);

  const isLinear = tour.mode === "linear";
  const memberGroups = useMemo(() => groupByLocation(members, pathOf), [members, pathOf]);

  const setMode = (mode: string) => {
    void db.transact(
      db.tx.tours[tour.id].update({
        mode,
        // Switching to linear seeds an order from the current set; leaving
        // linear drops it, since the other modes don't carry one.
        //
        // Cleared with null, not undefined: undefined keys are dropped from
        // the transaction payload entirely, so the old order silently
        // survived a round-trip through freeform and came back when linear
        // was re-selected — resurrecting a stale sequence instead of
        // reseeding from current membership.
        checkpointOrder: mode === "linear" ? ordered.map((c) => c.id) : null,
      }),
    );
  };

  // One transaction however many are picked — the dialog is what makes
  // "every checkpoint on Dock C" a single action instead of a dozen.
  const addCheckpoints = (ids: string[]) => {
    if (ids.length === 0) return;
    void db.transact(
      db.tx.tours[tour.id]
        .link({ checkpoints: ids })
        .update(
          isLinear
            ? { checkpointOrder: [...ordered.map((c) => c.id), ...ids] }
            : {},
        ),
    );
  };

  const removeCheckpoint = (checkpointId: string) => {
    void db.transact(
      db.tx.tours[tour.id]
        .unlink({ checkpoints: checkpointId })
        .update(
          isLinear
            ? {
                checkpointOrder: ordered
                  .map((c) => c.id)
                  .filter((cid) => cid !== checkpointId),
              }
            : {},
        ),
    );
  };

  const duplicate = async () => {
    const copyId = id();
    await db.transact(
      db.tx.tours[copyId]
        .update({
          name: `${tour.name} (copy)`,
          mode: tour.mode,
          // The copy points at the same checkpoints, so the saved order
          // transfers as-is.
          ...(isLinear ? { checkpointOrder: ordered.map((c) => c.id) } : {}),
        })
        .link(members.length > 0 ? { checkpoints: members.map((c) => c.id) } : {}),
    );
    onDuplicated(copyId);
  };

  const remove = async () => {
    if (!window.confirm(`Delete tour "${tour.name}"?`)) return;
    await db.transact(db.tx.tours[tour.id].delete());
  };

  return (
    <div className="card">
      <div className="spread" style={{ flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <DraftInput
            className="input select-inline"
            value={tour.name}
            aria-label="Tour name"
            onCommit={(name) => void db.transact(db.tx.tours[tour.id].update({ name }))}
          />
          <div className="card-meta">
            {tour.mode.charAt(0).toUpperCase() + tour.mode.slice(1)} ·{" "}
            {members.length} checkpoint{members.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="row">
          <select
            className="select select-inline"
            value={tour.mode}
            aria-label="Tour mode"
            onChange={(e) => setMode(e.target.value)}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm btn-quiet" onClick={onToggle}>
            {expanded ? "Done" : "Checkpoints"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => void duplicate()}
          >
            Duplicate
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove()}>
            Delete
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          {/* Linear mode's sequence *is* its meaning, so it stays a single
              ordered list — grouping would scatter the very thing being
              edited. The unordered modes have no such constraint, so they
              group under the parent location like every other checkpoint
              list. */}
          {isLinear ? (
            <ReorderableList
              items={ordered}
              enabled
              onReorder={(orderedIds) =>
                void db.transact(
                  db.tx.tours[tour.id].update({ checkpointOrder: orderedIds }),
                )
              }
              renderItem={(c, i) => (
                <div className="card spread">
                  <span className="small">
                    <span className="muted">{i + 1}. </span>
                    {c.name}
                    {c.location?.name && (
                      <span className="muted"> · {c.location.name}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => removeCheckpoint(c.id)}
                  >
                    Remove
                  </button>
                </div>
              )}
            />
          ) : (
            memberGroups.map((g) => (
              <div key={g.locationId || "none"}>
                <div className="group-heading">
                  <span>{g.label}</span>
                </div>
                <div className="stack" style={{ gap: 4 }}>
                  {g.items.map((c) => (
                    <div key={c.id} className="card spread">
                      <span className="small">{c.name}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        onClick={() => removeCheckpoint(c.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
          {members.length === 0 && (
            <span className="muted small">
              No checkpoints yet — an empty tour saves fine, it just isn't
              meaningfully assignable until it has some.
            </span>
          )}

          <div className="row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              disabled={allCheckpoints.length === memberIds.size}
              onClick={() => setAdding(true)}
            >
              + Add checkpoints
            </button>
            {isLinear && members.length > 1 && (
              <span className="muted small">Drag ⠿ to reorder.</span>
            )}
          </div>

          {tour.mode === "randomized" && members.length > 0 && members.length < 4 && (
            <p className="muted small" style={{ marginTop: 6 }}>
              Randomized mode gets its unpredictability from set size — with
              only {members.length}, patterns stay fairly guessable.
            </p>
          )}
        </div>
      )}

      {adding && (
        <MultiSelectDialog
          title={`Add checkpoints to ${tour.name}`}
          options={allCheckpoints
            .filter((c) => !memberIds.has(c.id))
            .map((c) => ({
              id: c.id,
              name: c.name,
              group: c.location ? pathOf(c.location.id) : "No location",
            }))}
          onConfirm={addCheckpoints}
          onClose={() => setAdding(false)}
          emptyMessage="Every checkpoint is already on this tour."
        />
      )}
    </div>
  );
}
