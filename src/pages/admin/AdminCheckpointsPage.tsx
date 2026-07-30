import { useMemo, useState } from "react";
import { db, id } from "../../lib/db";
import { matchesTerms, queryTerms } from "../../lib/search";
import { groupByLocation, locationPathResolver } from "../../lib/checkpoints";
import { MultiSelectDialog } from "../shared/MultiSelectDialog";
import { NfcWriteDialog } from "../shared/NfcWriteDialog";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";
import { DraftInput, DraftNumberInput } from "../shared/DraftInput";

// Admin — Checkpoints (see docs/pages/admin-checkpoints.html).
// Gated by manage_locations, the same permission as Locations and Tours,
// since a checkpoint is a fixture of a location and a member of tours.
//
// Location Types & Locations can still create a checkpoint inline while
// you're standing on the location — that's the right place when you're
// building the hierarchy. This page is the other half: every checkpoint at
// once, for the jobs that are about checkpoints rather than about one
// location — auditing which are unused, fixing GPS radii, handing a batch to
// a tour, and creating them across many locations in a single pass.
export function AdminCheckpointsPage() {
  return (
    <AdminGate requires="manage_locations">
      <Checkpoints />
    </AdminGate>
  );
}

type CheckpointRow = {
  id: string;
  name: string;
  guidUrl: string;
  gpsLat?: number;
  gpsLng?: number;
  gpsValidationRadius?: number;
  location?: { id: string; name: string; parent?: { id: string } | null } | null;
  tours?: { id: string; name: string }[];
  checklistTemplates?: { id: string; name: string }[];
};

function Checkpoints() {
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [assigningTour, setAssigningTour] = useState(false);
  const [onlyUnused, setOnlyUnused] = useState(false);

  const { data } = db.useQuery({
    checkpoints: { location: { parent: {} }, tours: {}, checklistTemplates: {} },
    locations: { parent: {}, checkpoints: {} },
    tours: { checkpoints: {} },
  });

  // Memoized because `?? []` mints a fresh array on every render, which
  // would rebuild the path cache below each time.
  const locations = useMemo(() => data?.locations ?? [], [data]);
  const tours = data?.tours ?? [];

  // Full ancestor path per location — "Slip 14" is meaningless on its own
  // when every dock has one, and the path is what the filter searches and
  // what each group is headed by.
  const pathOf = useMemo(() => locationPathResolver(locations), [locations]);

  const checkpoints = useMemo(() => {
    const all = (data?.checkpoints ?? []) as CheckpointRow[];
    const terms = queryTerms(filter);
    return all
      .filter((c) => {
        const path = c.location ? pathOf(c.location.id) : "";
        return matchesTerms([c.name, path], terms);
      })
      .filter((c) =>
        onlyUnused
          ? (c.tours ?? []).length === 0 &&
            (c.checklistTemplates ?? []).length === 0
          : true,
      )
      .sort((a, b) => {
        const pa = a.location ? pathOf(a.location.id) : "";
        const pb = b.location ? pathOf(b.location.id) : "";
        return (
          pa.localeCompare(pb, undefined, { numeric: true }) ||
          a.name.localeCompare(b.name, undefined, { numeric: true })
        );
      });
  }, [data, filter, onlyUnused, pathOf]);

  // Grouped under their location, so the row itself only has to carry the
  // checkpoint's own name.
  const groups = useMemo(() => groupByLocation(checkpoints, pathOf), [checkpoints, pathOf]);

  const visibleIds = checkpoints.map((c) => c.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((cid) => selected.has(cid));

  const toggle = (checkpointId: string) => {
    const next = new Set(selected);
    if (next.has(checkpointId)) next.delete(checkpointId);
    else next.add(checkpointId);
    setSelected(next);
  };

  // One checkpoint per chosen location, named after it — the shape that
  // almost every marina wants and that used to take a trip through the
  // location tree for each one.
  const createAt = (locationIds: string[]) => {
    if (locationIds.length === 0) return;
    const byId = new Map(locations.map((l) => [l.id, l]));
    void db.transact(
      locationIds.map((locationId) => {
        const existing = byId.get(locationId)?.checkpoints?.length ?? 0;
        const base = byId.get(locationId)?.name ?? "Checkpoint";
        return db.tx.checkpoints[id()]
          .update({
            name: existing === 0 ? base : `${base} ${existing + 1}`,
            // Auto-generated, never user-entered — this is the value the
            // physical NFC tag / QR code encodes.
            guidUrl: crypto.randomUUID(),
          })
          .link({ location: locationId });
      }),
    );
  };

  const addSelectedToTour = (tourId: string) => {
    const tour = tours.find((t) => t.id === tourId);
    if (!tour) return;
    const already = new Set((tour.checkpoints ?? []).map((c) => c.id));
    const adding = [...selected].filter((cid) => !already.has(cid));
    if (adding.length === 0) return;
    void db.transact(
      db.tx.tours[tourId]
        .link({ checkpoints: adding })
        .update(
          // Linear tours carry an explicit sequence; new members land at the
          // end, where they can be dragged into place on the Tours screen.
          tour.mode === "linear"
            ? {
                checkpointOrder: [
                  ...(tour.checkpointOrder ?? (tour.checkpoints ?? []).map((c) => c.id)),
                  ...adding,
                ],
              }
            : {},
        ),
    );
    setSelected(new Set());
  };

  const deleteSelected = () => {
    const count = selected.size;
    if (
      !window.confirm(
        `Delete ${count} checkpoint${count === 1 ? "" : "s"}? Their scan URLs stop working, ` +
          `and any physical tag encoding one becomes dead. Past check-ins are kept.`,
      )
    )
      return;
    void db.transact([...selected].map((cid) => db.tx.checkpoints[cid].delete()));
    setSelected(new Set());
  };

  const total = (data?.checkpoints ?? []).length;

  return (
    <div>
      <AdminHeader title="Checkpoints">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={locations.length === 0}
          title={locations.length === 0 ? "Create a location first" : undefined}
          onClick={() => setCreating(true)}
        >
          + Add checkpoints
        </button>
      </AdminHeader>

      <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <input
          className="input select-inline"
          style={{ minWidth: 200 }}
          placeholder="Filter by name or location…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <label className="row" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={onlyUnused}
            onChange={(e) => setOnlyUnused(e.target.checked)}
          />
          <span className="small">On no tour or template</span>
        </label>
        {visibleIds.length > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() =>
              setSelected(allVisibleSelected ? new Set() : new Set(visibleIds))
            }
          >
            {allVisibleSelected ? "Deselect all" : `Select all ${visibleIds.length}`}
          </button>
        )}
        <span className="muted small">
          {checkpoints.length === total
            ? `${total} total`
            : `${checkpoints.length} of ${total}`}
        </span>
      </div>

      {selected.size > 0 && (
        <div className="card spread" style={{ marginBottom: 12, flexWrap: "wrap" }}>
          <span className="small">
            {selected.size} selected
          </span>
          <div className="row">
            <button
              type="button"
              className="btn btn-sm"
              disabled={tours.length === 0}
              title={tours.length === 0 ? "No tours defined yet" : undefined}
              onClick={() => setAssigningTour(true)}
            >
              Add to tour…
            </button>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={deleteSelected}>
              Delete
            </button>
          </div>
        </div>
      )}

      <div>
        {groups.map((g) => {
          const ids = g.items.map((c) => c.id);
          const allOn = ids.every((cid) => selected.has(cid));
          return (
            <div key={g.locationId || "none"}>
              <div className="group-heading">
                <span>{g.label}</span>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => {
                    const next = new Set(selected);
                    for (const cid of ids) {
                      if (allOn) next.delete(cid);
                      else next.add(cid);
                    }
                    setSelected(next);
                  }}
                >
                  {allOn ? "None" : "All"} · {g.items.length}
                </button>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {g.items.map((c) => (
                  <CheckpointCard
                    key={c.id}
                    checkpoint={c}
                    selected={selected.has(c.id)}
                    onToggleSelect={() => toggle(c.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {checkpoints.length === 0 && (
          <div className="placeholder">
            <div className="big">
              {total === 0 ? "No checkpoints yet" : "Nothing matches"}
            </div>
            {total === 0 &&
              "Add them here across many locations at once, or one at a time from a location in Location Types & Locations."}
          </div>
        )}
      </div>

      {creating && (
        <MultiSelectDialog
          title="Add a checkpoint at each of these locations"
          options={[...locations]
            .sort((a, b) =>
              pathOf(a.id).localeCompare(pathOf(b.id), undefined, { numeric: true }),
            )
            .map((l) => {
              const existing = l.checkpoints?.length ?? 0;
              return {
                id: l.id,
                name: existing > 0 ? `${l.name} · has ${existing}` : l.name,
                group: l.parent?.id ? pathOf(l.parent.id) : "Top level",
              };
            })}
          onConfirm={createAt}
          onClose={() => setCreating(false)}
          confirmLabel="Create at"
          emptyMessage="No locations exist yet."
        />
      )}

      {assigningTour && (
        <TourPickerDialog
          tours={tours}
          count={selected.size}
          onPick={(tourId) => addSelectedToTour(tourId)}
          onClose={() => setAssigningTour(false)}
        />
      )}
    </div>
  );
}

function CheckpointCard({
  checkpoint,
  selected,
  onToggleSelect,
}: {
  checkpoint: CheckpointRow;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const [writingTag, setWritingTag] = useState(false);
  const url = `${window.location.origin}/checkin/${checkpoint.guidUrl}`;

  const update = (fields: Record<string, unknown>) =>
    void db.transact(db.tx.checkpoints[checkpoint.id].update(fields));

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const tourNames = (checkpoint.tours ?? []).map((t) => t.name);
  const templateNames = (checkpoint.checklistTemplates ?? []).map((t) => t.name);
  const unused = tourNames.length === 0 && templateNames.length === 0;

  return (
    <div className="card">
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className="row" style={{ minWidth: 0, flex: "1 1 260px" }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select ${checkpoint.name}`}
          />
          <span style={{ minWidth: 0 }}>
            <DraftInput
              className="input select-inline"
              value={checkpoint.name}
              aria-label="Checkpoint name"
              onCommit={(name) => update({ name })}
            />
            {/* The group heading already states where this is; repeating the
                path on every row is the noise that pushed marinas into
                naming checkpoints after their location in the first place. */}
          </span>
        </span>
        <div className="row">
          {unused ? (
            <span className="badge badge-warn">Unused</span>
          ) : (
            <span className="muted small">
              {tourNames.length > 0 &&
                `${tourNames.length} tour${tourNames.length === 1 ? "" : "s"}`}
              {tourNames.length > 0 && templateNames.length > 0 && " · "}
              {templateNames.length > 0 &&
                `${templateNames.length} template${templateNames.length === 1 ? "" : "s"}`}
            </span>
          )}
          <button type="button" className="btn btn-sm" onClick={() => void copy()}>
            {copied ? "Copied ✓" : "Copy URL"}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setWritingTag(true)}>
            Write NFC tag
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => setOpen(!open)}
          >
            {open ? "Done" : "Details"}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <span className="small muted">GPS</span>
            <DraftNumberInput
              className="input select-inline"
              style={{ width: 120 }}
              placeholder="lat"
              aria-label="Latitude"
              value={checkpoint.gpsLat}
              onCommit={(gpsLat) => update({ gpsLat })}
            />
            <DraftNumberInput
              className="input select-inline"
              style={{ width: 120 }}
              placeholder="lng"
              aria-label="Longitude"
              value={checkpoint.gpsLng}
              onCommit={(gpsLng) => update({ gpsLng })}
            />
            <span className="small muted">radius (m)</span>
            <DraftNumberInput
              className="input select-inline"
              style={{ width: 110 }}
              placeholder="marina default"
              aria-label="GPS radius override"
              value={checkpoint.gpsValidationRadius}
              onCommit={(gpsValidationRadius) => update({ gpsValidationRadius })}
            />
          </div>

          {(tourNames.length > 0 || templateNames.length > 0) && (
            <p className="muted small" style={{ marginTop: 6 }}>
              {tourNames.length > 0 && <>On: {tourNames.join(", ")}. </>}
              {templateNames.length > 0 && <>Triggers: {templateNames.join(", ")}.</>}
            </p>
          )}

          <code className="small muted" style={{ wordBreak: "break-all" }}>
            {url}
          </code>

          <div className="row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => {
                if (
                  !window.confirm(
                    `Delete "${checkpoint.name}"? Its scan URL stops working and any ` +
                      `physical tag encoding it becomes dead. Past check-ins are kept.`,
                  )
                )
                  return;
                void db.transact(db.tx.checkpoints[checkpoint.id].delete());
              }}
            >
              Delete checkpoint
            </button>
          </div>
        </div>
      )}

      {writingTag && (
        <NfcWriteDialog
          checkpointName={checkpoint.name}
          url={url}
          onClose={() => setWritingTag(false)}
        />
      )}
    </div>
  );
}

function TourPickerDialog({
  tours,
  count,
  onPick,
  onClose,
}: {
  tours: { id: string; name: string; mode: string }[];
  count: number;
  onPick: (tourId: string) => void;
  onClose: () => void;
}) {
  const [tourId, setTourId] = useState("");
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Add {count} checkpoint{count === 1 ? "" : "s"} to a tour
        </div>
        <div className="field">
          <select
            className="select"
            value={tourId}
            onChange={(e) => setTourId(e.target.value)}
          >
            <option value="">Pick a tour…</option>
            {[...tours]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.mode})
                </option>
              ))}
          </select>
          <p className="muted small" style={{ marginTop: 4 }}>
            Ones already on that tour are skipped. On a linear tour they land
            at the end, ready to be dragged into place.
          </p>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!tourId}
            onClick={() => {
              onPick(tourId);
              onClose();
            }}
          >
            Add
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
