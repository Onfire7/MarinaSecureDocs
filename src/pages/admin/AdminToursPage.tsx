import { useMemo, useState } from "react";
import {
  addTourCheckpoints,
  deleteTour,
  duplicateTour,
  removeTourCheckpoint,
  saveTour,
  setTourCheckpoints,
  useCheckpoints,
  useTourCheckpoints,
  useTours,
  type CheckpointRow,
  type TourCheckpointRow,
  type TourRow,
} from "../../data/checkpoints";
import { useLocations } from "../../data/locations";
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

  const { data: tours } = useTours();
  const { data: allCheckpoints } = useCheckpoints();
  const { data: allTourCheckpoints } = useTourCheckpoints();
  // Ancestor paths for group labels — a bare location name can repeat between
  // docks, which is the ambiguity grouping exists to remove.
  const { data: locations } = useLocations();
  const pathOf = useMemo(() => locationPathResolver(locations), [locations]);

  // Named inline rather than through a prompt dialog, matching how Location
  // Types are added — one box, one button, no modal to dismiss.
  const addTour = async () => {
    if (!newName.trim()) return;
    const tourId = await saveTour({ name: newName.trim(), mode: "freeform" });
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
            members={allTourCheckpoints.filter((c) => c.tour_id === t.id)}
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

function TourCard({
  tour,
  members,
  allCheckpoints,
  pathOf,
  expanded,
  onToggle,
  onDuplicated,
}: {
  tour: TourRow;
  /** Already in tour order — tour_checkpoints.position. */
  members: TourCheckpointRow[];
  allCheckpoints: CheckpointRow[];
  pathOf: (locationId: string) => string;
  expanded: boolean;
  onToggle: () => void;
  onDuplicated: (tourId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const memberIds = new Set(members.map((c) => c.id));

  // Every mode reads the same ordered list. Order used to be a json array that
  // only linear mode carried, and switching away from linear had to explicitly
  // null it — otherwise a stale sequence survived the round trip and came back
  // when linear was re-selected. Position is a column on the link now, so
  // there is no second copy to go stale.
  const ordered = members;

  const isLinear = tour.mode === "linear";
  const memberGroups = useMemo(() => groupByLocation(members, pathOf), [members, pathOf]);

  const setMode = (mode: string) => {
    void saveTour({ id: tour.id, name: tour.name, mode });
  };

  // One transaction however many are picked — the dialog is what makes
  // "every checkpoint on Dock C" a single action instead of a dozen.
  const addCheckpoints = (ids: string[]) => {
    if (ids.length === 0) return;
    void addTourCheckpoints(tour.id, ids);
  };

  const removeCheckpoint = (linkId: string) => {
    void removeTourCheckpoint(linkId);
  };

  const duplicate = async () => {
    const copyId = await duplicateTour(tour.id, `${tour.name} (copy)`, tour.mode);
    onDuplicated(copyId);
  };

  const remove = async () => {
    if (!window.confirm(`Delete tour "${tour.name}"?`)) return;
    await deleteTour(tour.id);
  };

  return (
    <div className="card">
      <div className="spread" style={{ flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <DraftInput
            className="input select-inline"
            value={tour.name}
            aria-label="Tour name"
            onCommit={(name) => void saveTour({ id: tour.id, name, mode: tour.mode })}
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
              onReorder={(orderedIds) => void setTourCheckpoints(tour.id, orderedIds)}
              renderItem={(c, i) => (
                <div className="card spread">
                  <span className="small">
                    <span className="muted">{i + 1}. </span>
                    {c.name}
                    {c.location_name && (
                      <span className="muted"> · {c.location_name}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => removeCheckpoint(c.link_id)}
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
                        onClick={() => removeCheckpoint(c.link_id)}
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
              group: c.location_id ? pathOf(c.location_id) : "No location",
            }))}
          onConfirm={addCheckpoints}
          onClose={() => setAdding(false)}
          emptyMessage="Every checkpoint is already on this tour."
        />
      )}
    </div>
  );
}
