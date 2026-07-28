import { useMemo, useState } from "react";
import { db, id } from "../../lib/db";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";
import { useTextPrompt } from "../shared/TextPromptDialog";

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
  const [askText, promptNode] = useTextPrompt();

  const { data } = db.useQuery({
    tours: { checkpoints: { location: {} } },
    checkpoints: { location: {} },
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

  const addTour = async () => {
    const name = await askText("New tour name:");
    if (!name?.trim()) return;
    await db.transact(
      db.tx.tours[id()].update({ name: name.trim(), mode: "freeform" }),
    );
  };

  return (
    <div>
      {promptNode}
      <AdminHeader title="Tours">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => void addTour()}>
          + Add tour
        </button>
      </AdminHeader>

      {allCheckpoints.length === 0 && (
        <div className="badge badge-warn" style={{ display: "block", marginBottom: 12 }}>
          No checkpoints exist yet — create them in Location Types & Locations
          before assembling a tour.
        </div>
      )}

      <div className="stack" style={{ gap: 8 }}>
        {tours.map((t) => (
          <TourCard
            key={t.id}
            tour={t}
            allCheckpoints={allCheckpoints}
            expanded={expanded === t.id}
            onToggle={() => setExpanded(expanded === t.id ? null : t.id)}
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
  checkpointOrder?: string[];
  checkpoints?: { id: string; name: string; location?: { name: string } | null }[];
};

function TourCard({
  tour,
  allCheckpoints,
  expanded,
  onToggle,
}: {
  tour: TourRow;
  allCheckpoints: { id: string; name: string; location?: { name: string } | null }[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const [askText, promptNode] = useTextPrompt();
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

  const setMode = (mode: string) => {
    void db.transact(
      db.tx.tours[tour.id].update({
        mode,
        // Switching to linear seeds an order from the current set; leaving
        // linear drops it, since the other modes don't carry one.
        checkpointOrder: mode === "linear" ? ordered.map((c) => c.id) : undefined,
      }),
    );
  };

  const addCheckpoint = (checkpointId: string) => {
    if (!checkpointId) return;
    void db.transact(
      db.tx.tours[tour.id]
        .link({ checkpoints: checkpointId })
        .update(
          tour.mode === "linear"
            ? { checkpointOrder: [...ordered.map((c) => c.id), checkpointId] }
            : {},
        ),
    );
  };

  const removeCheckpoint = (checkpointId: string) => {
    void db.transact(
      db.tx.tours[tour.id]
        .unlink({ checkpoints: checkpointId })
        .update(
          tour.mode === "linear"
            ? {
                checkpointOrder: ordered
                  .map((c) => c.id)
                  .filter((cid) => cid !== checkpointId),
              }
            : {},
        ),
    );
  };

  const move = (index: number, delta: -1 | 1) => {
    const ids = ordered.map((c) => c.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void db.transact(db.tx.tours[tour.id].update({ checkpointOrder: ids }));
  };

  const rename = async () => {
    const name = await askText("Rename tour:", tour.name);
    if (!name?.trim()) return;
    await db.transact(db.tx.tours[tour.id].update({ name: name.trim() }));
  };

  const remove = async () => {
    if (!window.confirm(`Delete tour "${tour.name}"?`)) return;
    await db.transact(db.tx.tours[tour.id].delete());
  };

  return (
    <div className="card">
      {promptNode}
      <div className="spread" style={{ flexWrap: "wrap" }}>
        <div>
          <div className="card-title">{tour.name}</div>
          <div className="card-meta">
            {tour.mode.charAt(0).toUpperCase() + tour.mode.slice(1)} ·{" "}
            {members.length} checkpoint{members.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="row">
          <select
            className="select select-inline"
            value={tour.mode}
            onChange={(e) => setMode(e.target.value)}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => void rename()}>
            Rename
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={onToggle}>
            {expanded ? "Done" : "Checkpoints"}
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove()}>
            Delete
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <div className="stack" style={{ gap: 4, marginBottom: 8 }}>
            {ordered.map((c, i) => (
              <div key={c.id} className="card spread">
                <span className="small">
                  {tour.mode === "linear" && (
                    <span className="muted">{i + 1}. </span>
                  )}
                  {c.name}
                  {c.location?.name && (
                    <span className="muted"> · {c.location.name}</span>
                  )}
                </span>
                <span className="row" style={{ gap: 4 }}>
                  {tour.mode === "linear" && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        aria-label="Move earlier"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        disabled={i === ordered.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label="Move later"
                      >
                        ↓
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => removeCheckpoint(c.id)}
                  >
                    Remove
                  </button>
                </span>
              </div>
            ))}
            {members.length === 0 && (
              <span className="muted small">
                No checkpoints yet — an empty tour saves fine, it just isn't
                meaningfully assignable until it has some.
              </span>
            )}
          </div>

          <select
            className="select select-inline"
            value=""
            onChange={(e) => addCheckpoint(e.target.value)}
          >
            <option value="">Add a checkpoint…</option>
            {allCheckpoints
              .filter((c) => !memberIds.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.location?.name ? ` — ${c.location.name}` : ""}
                </option>
              ))}
          </select>

          {tour.mode === "randomized" && members.length > 0 && members.length < 4 && (
            <p className="muted small" style={{ marginTop: 6 }}>
              Randomized mode gets its unpredictability from set size — with
              only {members.length}, patterns stay fairly guessable.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
