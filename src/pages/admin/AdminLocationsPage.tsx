import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  compareNames,
  DEFAULT_PLACEMENT_STYLE,
  placementStyle,
  type PlacementShape,
} from "../../lib/locations";
import {
  bulkUpdateLocations,
  createPlacement,
  deleteLocationType,
  deleteMarinaMap,
  deletePlacement,
  placementOf,
  saveLocation,
  saveLocationType,
  saveMarinaMap,
  savePlacement,
  setTypeParents,
  deleteLocationWithPlacements,
  useLocationDependencies,
  useLocations,
  useLocationTypeParents,
  useLocationTypes,
  useMarinaMaps,
  usePlacements,
  type LocationInput,
  type LocationRow,
  type LocationTypeRow,
  type MarinaMapRow,
} from "../../data/locations";
import {
  DEFAULT_POST_RESERVATION_STATUS,
  resolveStatusByName,
  useLocationStatuses,
} from "../../data/lookups";
import {
  createCheckpoint,
  deleteCheckpoint,
  saveCheckpoint,
  useCheckpoints,
  type CheckpointRow,
} from "../../data/checkpoints";
import { useLeases } from "../../data/leases";
import { attachmentUrl, captureAttachment } from "../../data/files";
import { LocationPicker, type PickerLocation } from "../shared/LocationPicker";
import { runSetupPlan } from "../../data/setup";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { NfcWriteDialog } from "../shared/NfcWriteDialog";
import { NameGeneratorDialog } from "./NameGeneratorDialog";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";
import { locationPathResolver } from "../../lib/checkpoints";
import {
  DraftInput,
  DraftNumberInput,
} from "../shared/DraftInput";

const EXPANDED_KEY = "marinasecure.admin.locations.expanded";
const LAST_USED_KEY = "marinasecure.admin.locations.lastUsed";

/**
 * Setting up a marina means creating hundreds of near-identical locations,
 * so the create dialog reopens with the type and parent last used *in this
 * browser* — following your own session rather than a co-admin's last write,
 * and working offline.
 */
function readLastUsed(): { typeId: string; parentId: string } {
  try {
    const raw = localStorage.getItem(LAST_USED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return { typeId: parsed.typeId ?? "", parentId: parsed.parentId ?? "" };
  } catch {
    return { typeId: "", parentId: "" };
  }
}

function writeLastUsed(value: { typeId: string; parentId: string }): void {
  try {
    localStorage.setItem(LAST_USED_KEY, JSON.stringify(value));
  } catch {
    // A full or disabled localStorage shouldn't block creating locations.
  }
}

// Admin — Location Types & Locations Setup (see docs/pages/admin-locations.html).
// Three nested concerns: the type system, the actual locations (and their
// checkpoints), and the map-plotting layer backing both schematic map views.
export function AdminLocationsPage() {
  return (
    <AdminGate requires="manage_locations">
      <LocationsAdmin />
    </AdminGate>
  );
}

type Tab = "types" | "locations" | "bulk" | "maps";

function LocationsAdmin() {
  const [tab, setTab] = useState<Tab>("locations");

  return (
    <div>
      <AdminHeader title="Location Types & Locations" />

      <div className="chip-row">
        {(["types", "locations", "bulk", "maps"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={"chip" + (tab === t ? " active" : "")}
            onClick={() => setTab(t)}
          >
            {t === "types"
              ? "Location types"
              : t === "locations"
                ? "Locations & checkpoints"
                : t === "bulk"
                  ? "Bulk edit"
                  : "Maps & plotting"}
          </button>
        ))}
      </div>

      {tab === "types" && <TypesTab />}
      {tab === "locations" && <LocationsTab />}
      {tab === "bulk" && <BulkEditTab />}
      {tab === "maps" && <MapsTab />}
    </div>
  );
}

// ---------------------------------------------------------------- Bulk edit

/**
 * Change one setting across many locations at once.
 *
 * The tree next door is right for finding a location and right for editing
 * one; it is hopeless for "make every slip on every dock reservable", which
 * otherwise means opening two hundred rows and ticking the same box in each.
 * So this is a flat list with a filter, a type filter, and one setting
 * applied to whatever is ticked.
 *
 * Every action here is a single field on a single namespace, applied in one
 * transaction. Nothing that changes a location's shape — its type, its
 * parent — belongs in a bulk tool: those need to be seen one at a time.
 */
function BulkEditTab() {
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");
  const [postStatus, setPostStatus] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const { data: allLocations } = useLocations();
  const { data: types } = useLocationTypes();
  const { data: leases } = useLeases();
  const { statuses } = useLocationStatuses();
  const locations = useMemo(
    () => [...allLocations].sort((a, b) => compareNames(a.name, b.name)),
    [allLocations],
  );
  const pathOf = useMemo(() => locationPathResolver(locations), [locations]);
  const typeOf = (l: LocationRow) => types.find((t) => t.id === l.location_type_id);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return locations.filter((l) => {
      if (typeFilter && l.location_type_id !== typeFilter) return false;
      if (!q) return true;
      return (l.name + " " + pathOf(l.id)).toLowerCase().includes(q);
    });
  }, [locations, filter, typeFilter, pathOf]);

  const shownIds = shown.map((l) => l.id);
  const allShownSelected =
    shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  const chosen = locations.filter((l) => selected.has(l.id));

  const toggle = (locationId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(locationId)) next.add(locationId);
      return next;
    });

  const apply = (
    what: string,
    build: (l: LocationRow) => Partial<LocationInput> | null,
  ) => {
    const edits: { id: string; changes: Partial<LocationInput> }[] = [];
    let skipped = 0;
    for (const l of chosen) {
      const changes = build(l);
      if (!changes) {
        skipped++;
        continue;
      }
      edits.push({ id: l.id, changes });
    }
    if (edits.length === 0) {
      setResult(`Nothing to do — ${what} applies to none of the ${chosen.length} selected.`);
      return;
    }
    void bulkUpdateLocations(edits);
    setResult(
      `${what} on ${edits.length} location${edits.length === 1 ? "" : "s"}` +
        (skipped > 0 ? ` · ${skipped} skipped — their type doesn't allow it` : ""),
    );
  };

  // Enabling reservations where a lease is already running is legal but odd,
  // and worth saying out loud rather than asking two hundred times.
  const now = Date.now();
  const leasedAndChosen = chosen.filter((l) =>
    leases.some(
      (x) =>
        x.location_id === l.id &&
        (!x.start_date || new Date(x.start_date).getTime() <= now) &&
        (!x.end_date || new Date(x.end_date).getTime() >= now),
    ),
  ).length;

  return (
    <div>
      <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
        <input
          className="input select-inline"
          style={{ minWidth: 180 }}
          placeholder="Filter by name or path…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <select
          className="select select-inline"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">Every type</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() =>
            setSelected((prev) => {
              const next = new Set(prev);
              if (allShownSelected) for (const id of shownIds) next.delete(id);
              else for (const id of shownIds) next.add(id);
              return next;
            })
          }
        >
          {allShownSelected ? "Deselect" : "Select"} {shown.length} shown
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        )}
        <span className="muted small">{selected.size} selected</span>
      </div>

      {selected.size > 0 && (
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="field-inline" style={{ marginBottom: 8 }}>
            <span className="field-label">Reservations</span>
            <span className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  apply("Reservations enabled", (l) =>
                    typeOf(l)?.allows_reservations === 1
                      ? {
                          reservationEnabled: true,
                          // Only where the location has no post-checkout status
                          // of its own, and only if the marina has defined one
                          // by that name — a null here means "unchanged".
                          postReservationStatusId: l.post_reservation_status_id
                            ? undefined
                            : (resolveStatusByName(
                                statuses,
                                DEFAULT_POST_RESERVATION_STATUS,
                              )?.id ?? undefined),
                        }
                      : null,
                  )
                }
              >
                Enable
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  apply("Reservations disabled", (l) =>
                    typeOf(l)?.allows_reservations === 1
                      ? { reservationEnabled: false }
                      : null,
                  )
                }
              >
                Disable
              </button>
            </span>
          </div>

          <div className="field-inline" style={{ marginBottom: 8 }}>
            <span className="field-label">Leases</span>
            <span className="row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  apply("Leases enabled", (l) =>
                    typeOf(l)?.allows_leases === 1 ? { leaseEnabled: true } : null,
                  )
                }
              >
                Enable
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() =>
                  apply("Leases disabled", (l) =>
                    typeOf(l)?.allows_leases === 1 ? { leaseEnabled: false } : null,
                  )
                }
              >
                Disable
              </button>
            </span>
          </div>

          <div className="field-inline" style={{ marginBottom: 8 }}>
            <span className="field-label">Status</span>
            <span className="row" style={{ gap: 6 }}>
              <select
                className="select select-inline"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Pick a status…</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!status}
                onClick={() =>
                  apply(
                    `Status set to ${statuses.find((s) => s.id === status)?.name ?? "—"}`,
                    (l) => (typeOf(l)?.tracks_status === 1 ? { statusId: status } : null),
                  )
                }
              >
                Apply
              </button>
            </span>
          </div>

          <div className="field-inline" style={{ marginBottom: 0 }}>
            <span className="field-label">After check-out</span>
            <span className="row" style={{ gap: 6 }}>
              <select
                className="select select-inline"
                value={postStatus}
                onChange={(e) => setPostStatus(e.target.value)}
              >
                <option value="">Pick a status…</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!postStatus}
                onClick={() =>
                  apply(
                    `Post-checkout status set to ${
                      statuses.find((s) => s.id === postStatus)?.name ?? "—"
                    }`,
                    (l) =>
                      typeOf(l)?.allows_reservations === 1
                        ? { postReservationStatusId: postStatus }
                        : null,
                  )
                }
              >
                Apply
              </button>
            </span>
          </div>

          {leasedAndChosen > 0 && (
            <div className="badge badge-warn" style={{ display: "block", marginTop: 8 }}>
              {leasedAndChosen} of the selected {leasedAndChosen === 1 ? "has" : "have"} a
              running lease. Reservations alongside a lease are allowed, just unusual.
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="badge badge-good" style={{ display: "block", marginBottom: 10 }}>
          {result}
        </div>
      )}

      <div className="stack" style={{ gap: 2 }}>
        {shown.map((l) => (
          <label key={l.id} className="card row" style={{ cursor: "pointer", gap: 8 }}>
            <input
              type="checkbox"
              checked={selected.has(l.id)}
              onChange={() => toggle(l.id)}
            />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span className="card-title">{l.name}</span>
              <span className="card-meta" style={{ display: "block" }}>
                {pathOf(l.id)} · {l.type_name ?? "no type"}
                {l.tracks_status === 1 && ` · ${l.status_name ?? "—"}`}
              </span>
            </span>
            <span className="row" style={{ gap: 4, flex: "none" }}>
              {typeOf(l)?.allows_reservations === 1 && (
                <span className={l.reservation_enabled === 1 ? "badge badge-good" : "badge"}>
                  {l.reservation_enabled === 1 ? "Reservable" : "Not reservable"}
                </span>
              )}
              {typeOf(l)?.allows_leases === 1 && (
                <span className={l.lease_enabled === 1 ? "badge badge-good" : "badge"}>
                  {l.lease_enabled === 1 ? "Leasable" : "Not leasable"}
                </span>
              )}
            </span>
          </label>
        ))}
        {shown.length === 0 && (
          <span className="muted small">Nothing matches that filter.</span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Types

function TypesTab() {
  const [name, setName] = useState("");
  const { data: types } = useLocationTypes();
  const { data: locations } = useLocations();
  const { data: typeParents } = useLocationTypeParents();

  const add = async () => {
    if (!name.trim()) return;
    await saveLocationType({
      name: name.trim(),
      allowsReservations: false,
      allowsLeases: false,
      hasBoat: false,
      hasVehicle: false,
      tracksStatus: false,
    });
    setName("");
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="New type, e.g. Slip"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!name.trim()}
          onClick={() => void add()}
        >
          Add type
        </button>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        {types.map((t) => {
          const inUse = locations.filter((l) => l.location_type_id === t.id).length;
          const flags = {
            tracksStatus: t.tracks_status === 1,
            allowsReservations: t.allows_reservations === 1,
            allowsLeases: t.allows_leases === 1,
            hasBoat: t.has_boat === 1,
            hasVehicle: t.has_vehicle === 1,
          };
          const update = (changes: Partial<typeof flags> & { name?: string }) =>
            void saveLocationType({ id: t.id, name: t.name, ...flags, ...changes });
          const parentIds = typeParents
            .filter((p) => p.child_type_id === t.id)
            .map((p) => p.parent_type_id);

          return (
            <div key={t.id} className="card">
              <div className="spread" style={{ flexWrap: "wrap" }}>
                <div>
                  <DraftInput
                    className="input select-inline"
                    aria-label="Type name"
                    value={t.name}
                    onCommit={(name) => update({ name })}
                  />
                  <span className="muted small">
                    {" "}
                    · {inUse} location{inUse === 1 ? "" : "s"}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  // Deleting a type out from under its locations would orphan
                  // them, so it's blocked until they're reassigned.
                  disabled={inUse > 0}
                  title={inUse > 0 ? "Reassign its locations first" : undefined}
                  onClick={() => void deleteLocationType(t.id)}
                >
                  Delete
                </button>
              </div>

              <div className="row" style={{ flexWrap: "wrap", marginTop: 8 }}>
                {(
                  [
                    ["tracksStatus", "Track Status"],
                    ["allowsReservations", "Reservable"],
                    ["allowsLeases", "Leasable"],
                    ["hasBoat", "Holds a boat"],
                    ["hasVehicle", "Holds a vehicle"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="row" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={flags[key]}
                      onChange={(e) => update({ [key]: e.target.checked })}
                    />
                    <span className="small">{label}</span>
                  </label>
                ))}
              </div>

              <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
                <span className="field-label">May nest under</span>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  {types
                    .filter((o) => o.id !== t.id)
                    .map((o) => (
                      <label key={o.id} className="row" style={{ cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={parentIds.includes(o.id)}
                          onChange={(e) =>
                            void setTypeParents(
                              t.id,
                              e.target.checked
                                ? [...parentIds, o.id]
                                : parentIds.filter((x) => x !== o.id),
                            )
                          }
                        />
                        <span className="small">{o.name}</span>
                      </label>
                    ))}
                  {types.length <= 1 && (
                    <span className="muted small">
                      Add more types to define nesting. A type with no parents
                      is a root type.
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {types.length === 0 && (
          <div className="placeholder">
            <div className="big">No location types yet</div>
            Start with something like "Property" (a root), then "Dock" and "Slip".
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Locations

function LocationsTab() {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  // Expansion persists so drilling into a dock, editing, and coming back
  // doesn't collapse everything again.
  const [openIds, setOpenIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_KEY);
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set<string>();
    }
  });

  const { data: allLocations } = useLocations();
  const { data: types } = useLocationTypes();
  const { data: checkpoints } = useCheckpoints();
  const locations = useMemo(
    () => [...allLocations].sort((a, b) => compareNames(a.name, b.name)),
    [allLocations],
  );

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, typeof locations>();
    for (const l of locations) {
      const key = l.parent_id ?? null;
      const list = m.get(key) ?? [];
      list.push(l);
      m.set(key, list);
    }
    return m;
  }, [locations]);

  // Total descendants, so a collapsed row can say what's inside it.
  const descendantCount = useMemo(() => {
    const counts = new Map<string, number>();
    const count = (locationId: string): number => {
      const cached = counts.get(locationId);
      if (cached != null) return cached;
      const kids = childrenOf.get(locationId) ?? [];
      const total = kids.reduce((sum, k) => sum + 1 + count(k.id), 0);
      counts.set(locationId, total);
      return total;
    };
    for (const l of locations) count(l.id);
    return counts;
  }, [locations, childrenOf]);

  // Filtering reveals matches in place: keep every match plus its ancestors,
  // so a hit deep in the tree still shows where it lives.
  const { visibleIds, matchIds } = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return { visibleIds: null as Set<string> | null, matchIds: new Set<string>() };
    const byId = new Map(locations.map((l) => [l.id, l]));
    const terms = q.split(/\s+/).filter(Boolean);
    const matches = new Set(
      locations
        .filter((l) => {
          // Same short-term rule as the picker: "c" shouldn't match "Dock".
          const words: string[] = l.name.toLowerCase().split(/[\s/-]+/).filter(Boolean);
          const hay = l.name.toLowerCase();
          return terms.every((t) =>
            t.length <= 2 ? words.some((w) => w.startsWith(t)) : hay.includes(t),
          );
        })
        .map((l) => l.id),
    );
    const visible = new Set<string>(matches);
    for (const mid of matches) {
      let cursor = byId.get(mid)?.parent_id ?? undefined;
      let guard = 0;
      while (cursor && guard++ < 30) {
        visible.add(cursor);
        cursor = byId.get(cursor)?.parent_id ?? undefined;
      }
    }
    return { visibleIds: visible, matchIds: matches };
  }, [filter, locations]);

  const persist = (next: Set<string>) => {
    setOpenIds(next);
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      // A full or disabled localStorage shouldn't break the tree.
    }
  };

  const toggleOpen = (locationId: string) => {
    const next = new Set(openIds);
    if (next.has(locationId)) next.delete(locationId);
    else next.add(locationId);
    persist(next);
  };

  const expandAll = () => persist(new Set(locations.map((l) => l.id)));
  const collapseAll = () => persist(new Set());

  const roots = childrenOf.get(null) ?? [];

  const renderNode = (l: (typeof locations)[number], depth: number): ReactNode => {
    if (visibleIds && !visibleIds.has(l.id)) return null;
    const kids = childrenOf.get(l.id) ?? [];
    // While filtering, ancestors auto-expand so matches are actually reachable.
    const isOpen = visibleIds ? true : openIds.has(l.id);
    return (
      <div key={l.id}>
        <LocationRow
          location={l}
          types={types}
          allLocations={locations}
          checkpoints={checkpoints.filter((c) => c.location_id === l.id)}
          depth={depth}
          childCount={descendantCount.get(l.id) ?? 0}
          hasChildren={kids.length > 0}
          isOpen={isOpen}
          highlighted={matchIds.has(l.id)}
          expanded={editing === l.id}
          onSelect={() => {
            // Selecting a location reveals both its settings and its
            // children — no separate edit affordance to hunt for.
            const nowEditing = editing === l.id ? null : l.id;
            setEditing(nowEditing);
            if (nowEditing && kids.length > 0 && !openIds.has(l.id)) toggleOpen(l.id);
            if (!nowEditing && openIds.has(l.id)) toggleOpen(l.id);
          }}
        />
        {isOpen && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={types.length === 0}
          title={types.length === 0 ? "Define a location type first" : undefined}
          onClick={() => setCreating(true)}
        >
          + Add locations
        </button>
        <input
          className="input select-inline"
          style={{ minWidth: 200 }}
          placeholder="Filter by name…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className="btn btn-sm btn-quiet" onClick={expandAll}>
          Expand all
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={collapseAll}>
          Collapse all
        </button>
        <span className="muted small">{locations.length} total</span>
      </div>

      {roots.length === 0 && locations.length > 0 && (
        <span className="badge badge-warn">
          Every location has a parent — no root exists, so an overview map
          can't be scoped yet.
        </span>
      )}
      {locations.filter((l) => !l.parent_id).length === 0 && locations.length === 0 && (
        <span className="badge badge-warn">
          No root location yet — one is required before an overview map can be
          uploaded.
        </span>
      )}

      <div className="stack" style={{ gap: 4 }}>
        {roots.map((l) => renderNode(l, 0))}
        {locations.length === 0 && (
          <div className="placeholder">
            <div className="big">No locations yet</div>
          </div>
        )}
        {locations.length > 0 && visibleIds && visibleIds.size === 0 && (
          <div className="placeholder">
            <div className="big">Nothing matches "{filter}"</div>
          </div>
        )}
      </div>

      {creating && (
        <CreateLocationDialog
          types={types}
          locations={locations}
          onClose={() => setCreating(false)}
        />
      )}
    </div>
  );
}

function LocationRow({
  location,
  types,
  allLocations,
  checkpoints,
  depth,
  childCount,
  hasChildren,
  isOpen,
  highlighted,
  expanded,
  onSelect,
}: {
  location: LocationRow;
  types: LocationTypeRow[];
  allLocations: PickerLocation[];
  /** This location's own checkpoints. */
  checkpoints: CheckpointRow[];
  depth: number;
  childCount: number;
  hasChildren: boolean;
  isOpen: boolean;
  highlighted: boolean;
  expanded: boolean;
  onSelect: () => void;
}) {
  const { statuses } = useLocationStatuses();
  const update = (changes: Partial<LocationInput>) =>
    void saveLocation(location.id, changes);

  const locationType = types.find((t) => t.id === location.location_type_id);
  const typeAllowsReservations = locationType?.allows_reservations === 1;
  const typeAllowsLeases = locationType?.allows_leases === 1;
  const tracksStatus = location.tracks_status === 1;

  // Named after its location and renamed inline on the row below if that's
  // wrong — which it rarely is, since a checkpoint is nearly always "the
  // checkpoint at <this location>". Prompting first made every one of them a
  // modal round-trip for a name the admin had just typed.
  const addCheckpoint = async () => {
    const existing = checkpoints.length;
    await createCheckpoint({
      name: existing === 0 ? location.name : `${location.name} ${existing + 1}`,
      // Auto-generated, never user-entered — this is the value the physical
      // NFC tag or QR code encodes.
      guidUrl: crypto.randomUUID(),
      locationId: location.id,
      // Defaults from the location; per-checkpoint GPS radius falls back to
      // the marina default until overridden.
      gpsLat: location.gps_lat,
      gpsLng: location.gps_lng,
    });
  };

  return (
    <div
      className={"card tree-row" + (highlighted ? " tree-match" : "")}
      style={{ marginLeft: depth * 22 }}
    >
      <button type="button" className="tree-head" onClick={onSelect}>
        <span className="row" style={{ minWidth: 0 }}>
          {/* Indicator, not a separate control — the whole row toggles. */}
          <span className="tree-toggle" aria-hidden="true">
            {hasChildren ? (expanded || isOpen ? "▾" : "▸") : ""}
          </span>
          <span style={{ minWidth: 0 }}>
            <span className="card-title">{location.name}</span>
            <span className="card-meta" style={{ display: "block" }}>
              {location.type_name ?? "No type"}
              {tracksStatus && ` · ${location.status_name ?? "—"}`}
              {/* Say what's inside before you open it. */}
              {hasChildren && ` · ${childCount} inside`}
              {checkpoints.length > 0 && ` · ${checkpoints.length} checkpoint(s)`}
            </span>
          </span>
        </span>
      </button>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <div className="grid-2">
            <div>
              <div className="field">
                <span className="field-label">Name</span>
                <DraftInput
                  className="input"
                  value={location.name}
                  onCommit={(name) => update({ name })}
                />
              </div>
              {/* Containers and roots have no meaningful occupancy, so the
                  control is absent rather than showing a misleading value. */}
              {tracksStatus && (
                <div className="field">
                  <span className="field-label">Status</span>
                  <select
                    className="select select-inline"
                    value={location.status_id ?? ""}
                    onChange={(e) => update({ statusId: e.target.value || null })}
                  >
                    <option value="">—</option>
                    {statuses.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="field">
                <span className="field-label">Parent</span>
                <LocationPicker
                  locations={allLocations}
                  value={location.parent_id ?? ""}
                  excludeId={location.id}
                  onChange={(parentId) => update({ parentId: parentId || null })}
                />
              </div>
              <div className="field">
                <span className="field-label">GPS coordinates</span>
                <div className="row">
                  <DraftNumberInput
                    className="input select-inline"
                    placeholder="lat"
                    aria-label="Latitude"
                    value={location.gps_lat}
                    onCommit={(gpsLat) => update({ gpsLat })}
                  />
                  <DraftNumberInput
                    className="input select-inline"
                    placeholder="lng"
                    aria-label="Longitude"
                    value={location.gps_lng}
                    onCommit={(gpsLng) => update({ gpsLng })}
                  />
                </div>
              </div>

              {typeAllowsLeases && (
                <div className="field">
                  <span className="field-label">Leases</span>
                  <label className="row" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={location.lease_enabled === 1}
                      onChange={(e) => update({ leaseEnabled: e.target.checked })}
                    />
                    <span className="small">Can be leased</span>
                  </label>
                </div>
              )}

              {typeAllowsReservations && (
                <div className="field">
                  <span className="field-label">Reservations</span>
                  <label className="row" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={location.reservation_enabled === 1}
                      onChange={(e) =>
                        update({
                          reservationEnabled: e.target.checked,
                          // Seed the post-checkout status only when the
                          // location has none, and only if the marina has
                          // defined one by that name.
                          postReservationStatusId:
                            e.target.checked && !location.post_reservation_status_id
                              ? (resolveStatusByName(
                                  statuses,
                                  DEFAULT_POST_RESERVATION_STATUS,
                                )?.id ?? undefined)
                              : undefined,
                        })
                      }
                    />
                    <span className="small">Accepts reservations</span>
                  </label>
                  {location.reservation_enabled === 1 && (
                    <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                      <select
                        className="select select-inline"
                        value={location.reservation_visibility}
                        onChange={(e) =>
                          update({ reservationVisibility: e.target.value })
                        }
                      >
                        <option value="public">Defaults to Billable</option>
                        <option value="internal">Defaults to Non-Billable</option>
                      </select>
                      <span className="small muted">after check-out becomes</span>
                      <select
                        className="select select-inline"
                        value={location.post_reservation_status_id ?? ""}
                        onChange={(e) =>
                          update({ postReservationStatusId: e.target.value || null })
                        }
                      >
                        <option value="">— unchanged</option>
                        {statuses.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <DeleteLocationControl
                locationId={location.id}
                name={location.name}
              />
              <div className="section-title spread">
                <span>Checkpoints</span>
                <button type="button" className="btn btn-sm" onClick={() => void addCheckpoint()}>
                  + Add
                </button>
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {checkpoints.map((cp) => (
                  <CheckpointEditor key={cp.id} checkpoint={cp} />
                ))}
                {checkpoints.length === 0 && (
                  <span className="muted small">None here.</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Deleting a Location is blocked whenever anything real depends on it, and
 * says which thing — an enabled-but-destructive button here would take a
 * whole dock's subtree, or a slip's lease history, with one click.
 *
 * Only `locationMapPlacements` cascade: they're join records that carry no
 * information of their own once the location is gone, the same reasoning
 * (and the same treatment) map deletion already applies to them.
 *
 * Scoped to a single location and mounted only while its row is expanded,
 * so the dependency check costs one narrow query rather than pulling every
 * ticket and reservation in the marina into the tree view.
 */
function DeleteLocationControl({
  locationId,
  name,
}: {
  locationId: string;
  name: string;
}) {
  const { dependencies, isLoading } = useLocationDependencies(locationId);

  const blockers: string[] = [];
  if (dependencies) {
    const add = (n: number, singular: string, plural = `${singular}s`) => {
      if (n > 0) blockers.push(`${n} ${n === 1 ? singular : plural}`);
    };
    add(dependencies.children, "child location", "child locations");
    add(dependencies.checkpoints, "checkpoint");
    add(dependencies.maps, "map scoped to it", "maps scoped to it");
    add(dependencies.leases, "lease");
    add(dependencies.reservations, "reservation");
    add(dependencies.incidents, "incident");
    add(dependencies.tickets, "ticket");
    add(dependencies.notes, "note");
    if (dependencies.has_boat > 0) blockers.push("a boat berthed here");
    if (dependencies.has_vehicle > 0) blockers.push("a vehicle parked here");
  }

  const placements = dependencies?.placements ?? 0;

  const remove = async () => {
    const extra =
      placements > 0
        ? ` It's plotted on ${placements} map${placements === 1 ? "" : "s"}; those placements go too.`
        : "";
    if (!window.confirm(`Delete "${name}"?${extra} This can't be undone.`)) return;
    await deleteLocationWithPlacements(locationId);
  };

  if (isLoading) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <button
        type="button"
        className="btn btn-sm btn-danger"
        disabled={blockers.length > 0}
        title={
          blockers.length > 0
            ? `Blocked by ${blockers.join(", ")}`
            : "Permanently delete this location"
        }
        onClick={() => void remove()}
      >
        Delete location
      </button>
      {blockers.length > 0 && (
        <p className="muted small" style={{ marginTop: 4 }}>
          Can't delete — blocked by {blockers.join(", ")}. Reassign or remove
          first.
        </p>
      )}
    </div>
  );
}

function CheckpointEditor({
  checkpoint,
}: {
  checkpoint: CheckpointRow;
}) {
  const [copied, setCopied] = useState(false);
  const [writingTag, setWritingTag] = useState(false);
  const url = `${window.location.origin}/checkin/${checkpoint.guid_url}`;

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="card">
      <div className="spread" style={{ flexWrap: "wrap" }}>
        <DraftInput
          className="input select-inline"
          aria-label="Checkpoint name"
          value={checkpoint.name}
          onCommit={(name) => void saveCheckpoint(checkpoint.id, { name })}
        />
        <div className="row">
          {/* The only place the GUID URL is exposed — deliberately not on
              Checkpoint detail. */}
          <button type="button" className="btn btn-sm" onClick={() => void copy()}>
            {copied ? "Copied ✓" : "Copy URL"}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setWritingTag(true)}>
            Write NFC tag
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => void deleteCheckpoint(checkpoint.id)}
          >
            Delete
          </button>
        </div>
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <span className="small muted">GPS radius override (m)</span>
        <DraftNumberInput
          className="input select-inline"
          style={{ width: 100 }}
          placeholder="marina default"
          aria-label="GPS radius override"
          value={checkpoint.gps_validation_radius}
          onCommit={(gpsValidationRadius) =>
            void saveCheckpoint(checkpoint.id, { gpsValidationRadius })
          }
        />
      </div>
      <code className="small muted" style={{ wordBreak: "break-all" }}>
        {url}
      </code>

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

function CreateLocationDialog({
  types,
  locations,
  onClose,
}: {
  types: LocationTypeRow[];
  locations: LocationRow[];
  onClose: () => void;
}) {
  const { statuses } = useLocationStatuses();
  // Setting up a marina means creating the same shape over and over, so the
  // dialog reopens with whatever you used last rather than blank.
  const remembered = readLastUsed();
  const [names, setNames] = useState("");
  const [typeId, setTypeId] = useState(
    types.some((t) => t.id === remembered.typeId) ? remembered.typeId : "",
  );
  const [parentId, setParentId] = useState(
    locations.some((l) => l.id === remembered.parentId) ? remembered.parentId : "",
  );
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Most locations that get a checkpoint get exactly one, named after
  // themselves. Doing it here folds what used to be a per-location trip
  // through the tree — expand, click, name, submit — into one checkbox.
  const [withCheckpoints, setWithCheckpoints] = useState(false);

  // One location per non-blank line, de-duplicated — so pasting a slip list
  // straight out of a spreadsheet works.
  const parsedNames = useMemo(() => {
    const seen = new Set<string>();
    return names
      .split("\n")
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
      .filter((n) => {
        const key = n.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [names]);

  const existingNames = useMemo(
    () =>
      new Set(
        locations
          .filter((l) => (l.parent_id ?? "") === parentId)
          .map((l) => l.name.toLowerCase()),
      ),
    [locations, parentId],
  );
  const duplicates = parsedNames.filter((n) => existingNames.has(n.toLowerCase()));

  const create = async () => {
    if (parsedNames.length === 0 || !typeId) return;
    setSaving(true);
    // Only types that track status get one — a container labelled "Vacant" is
    // exactly the confusion this avoids — and only if the marina has a status
    // by that name at all.
    const tracksStatus = types.find((t) => t.id === typeId)?.tracks_status === 1;
    const vacant = tracksStatus
      ? resolveStatusByName(statuses, "Vacant")?.id ?? null
      : null;
    await runSetupPlan(
      {
        anchorId: parentId || null,
        containerTypeId: typeId,
        childTypeId: typeId,
        containerStatusId: vacant,
        childStatusId: vacant,
        childCheckpoints: false,
        containers: parsedNames.map((name) => ({
          name,
          checkpoint: withCheckpoints,
          children: [],
        })),
        tour: null,
        templateId: null,
        templateSectionStart: 0,
      },
      () => {},
    );
    writeLastUsed({ typeId, parentId });
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-card"
        style={{ maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-title" style={{ marginBottom: 10 }}>
          Add locations
        </div>

        <div className="field">
          <span className="field-label">Type — required</span>
          <select
            className="select"
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
          >
            <option value="">Select…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <span className="field-label">Parent</span>
          <LocationPicker
            locations={locations}
            value={parentId}
            onChange={setParentId}
            placeholder="Search by name or path, e.g. dock c"
          />
        </div>

        <div className="field">
          <span className="field-label spread">
            <span>Names — one per line, all sharing the type and parent above</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setGenerating(true)}
            >
              Generate…
            </button>
          </span>
          <textarea
            className="textarea"
            rows={8}
            value={names}
            onChange={(e) => setNames(e.target.value)}
            placeholder={"Slip 1\nSlip 2\nSlip 3"}
            autoFocus
          />
          <p className="muted small" style={{ marginTop: 4 }}>
            {parsedNames.length === 0
              ? "Blank lines and duplicates within the list are ignored."
              : `${parsedNames.length} location${parsedNames.length === 1 ? "" : "s"} will be created.`}
          </p>
          {duplicates.length > 0 && (
            <div className="badge badge-warn" style={{ display: "block", marginTop: 4 }}>
              {duplicates.length} name{duplicates.length === 1 ? "" : "s"} already
              exist under that parent ({duplicates.slice(0, 3).join(", ")}
              {duplicates.length > 3 ? "…" : ""}) — creating them anyway is
              allowed, names aren't identifiers.
            </div>
          )}
        </div>

        <div className="field">
          <label className="row" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={withCheckpoints}
              onChange={(e) => setWithCheckpoints(e.target.checked)}
            />
            <span className="small">
              Also create a checkpoint at each, named to match
            </span>
          </label>
          {withCheckpoints && parsedNames.length > 0 && (
            <p className="muted small" style={{ marginTop: 4 }}>
              {parsedNames.length} checkpoint
              {parsedNames.length === 1 ? "" : "s"} too — each gets its own
              scan URL, and any of them can be renamed afterwards.
            </p>
          )}
        </div>

        {generating && (
          <NameGeneratorDialog
            onClose={() => setGenerating(false)}
            onInsert={(generated) =>
              // Appended, not replaced — several runs can build one list.
              setNames((prev) =>
                [...prev.split("\n").filter((l) => l.trim()), ...generated].join("\n"),
              )
            }
          />
        )}

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={parsedNames.length === 0 || !typeId || saving}
            onClick={() => void create()}
          >
            {saving
              ? "Creating…"
              : `Create ${parsedNames.length || ""} location${parsedNames.length === 1 ? "" : "s"}`}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Maps

const UPLOAD_TIMEOUT_MS = 45_000;

// Supabase Storage's upload doesn't expose an AbortSignal, so the fetch()
// underneath has no timeout of its own — a stalled connection (as opposed to a
// rejected response, which is surfaced) would otherwise hang indefinitely.
// Racing it against a timeout guarantees the caller's spinner always resolves
// to an error. Shared by new-map upload and replace-image so there is one
// upload path, not two.
async function uploadFileWithTimeout(
  file: File,
  actorId: string | null,
): Promise<string> {
  return Promise.race([
    captureAttachment(file, actorId),
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "Upload timed out after 45s — check your connection and try again.",
            ),
          ),
        UPLOAD_TIMEOUT_MS,
      ),
    ),
  ]);
}

function MapsTab() {
  const [selectedMap, setSelectedMap] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [scopeId, setScopeId] = useState("");
  const [mapName, setMapName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const replaceFileRef = useRef<HTMLInputElement>(null);

  const current = useCurrent();
  const { data: maps } = useMarinaMaps();
  const { data: allPlacements } = usePlacements();
  const { data: allLocations } = useLocations();
  const locations = useMemo(
    () => [...allLocations].sort((a, b) => compareNames(a.name, b.name)),
    [allLocations],
  );
  const roots = locations.filter((l) => !l.parent_id);
  const active = maps.find((m) => m.id === selectedMap) ?? maps[0];
  const placementsOf = (mapId: string) =>
    allPlacements.filter((p) => p.map_id === mapId);

  const upload = async (file: File) => {
    // Scope is required before the upload completes — there's no way to
    // create an unscoped map.
    if (!scopeId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const attachmentId = await uploadFileWithTimeout(file, current.user?.id ?? null);
      const mapId = await saveMarinaMap({
        name: mapName.trim() || file.name,
        scopeId,
        imageAttachmentId: attachmentId,
      });
      setSelectedMap(mapId);
      setMapName("");
      setScopeId("");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  // Replacing an image is upload-new → relink, not an overwrite: the old
  // attachment row is left in place rather than deleted, because a placement
  // edit made against the old image is still a real edit and deleting the
  // bytes out from under an in-flight render is worse than an orphan.
  const replaceImage = async (map: NonNullable<typeof active>, file: File) => {
    setReplacing(true);
    setReplaceError(null);
    try {
      const attachmentId = await uploadFileWithTimeout(file, current.user?.id ?? null);
      await saveMarinaMap({
        id: map.id,
        name: map.name,
        scopeId: map.scope_id,
        imageAttachmentId: attachmentId,
      });
    } catch (err) {
      setReplaceError(err instanceof Error ? err.message : "Replace failed.");
    } finally {
      setReplacing(false);
    }
  };

  const deleteMap = async (map: NonNullable<typeof active>) => {
    const placementCount = placementsOf(map.id).length;
    const confirmed = window.confirm(
      `Delete "${map.scope_name ?? map.name}"? This removes the map image` +
        (placementCount > 0
          ? ` and unplots ${placementCount} location${placementCount === 1 ? "" : "s"} from it — those placements can't be recovered`
          : "") +
        `.`,
    );
    if (!confirmed) return;
    // The placements cascade with the map — they describe a position ON it and
    // mean nothing without it.
    await deleteMarinaMap(map.id);
    setSelectedMap(null);
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-title">Upload a map</div>
        {roots.length === 0 && (
          <div className="badge badge-warn" style={{ display: "block", marginBottom: 8 }}>
            No root location exists — create a top-level location (one with no
            parent) before uploading an overview map. Detail maps scoped to a
            child location are still fine.
          </div>
        )}
        {uploadError && (
          <div className="badge badge-bad" style={{ display: "block", marginBottom: 8 }}>
            {uploadError}
          </div>
        )}
        <div className="row" style={{ flexWrap: "wrap" }}>
          <input
            className="input select-inline"
            placeholder="Map name (optional)"
            value={mapName}
            onChange={(e) => setMapName(e.target.value)}
          />
          <div style={{ flex: "1 1 240px", minWidth: 220 }}>
            <LocationPicker
              locations={locations}
              value={scopeId}
              onChange={setScopeId}
              placeholder="Scope to a location — required…"
              allowNone={false}
            />
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!scopeId || uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? "Uploading…" : "Choose image & upload"}
          </button>
        </div>
      </div>

      {maps.length === 0 ? (
        <div className="placeholder">
          <div className="big">No maps uploaded yet</div>
        </div>
      ) : (
        <>
          <div className="chip-row">
            {maps.map((m) => (
              <button
                key={m.id}
                type="button"
                className={"chip" + (active?.id === m.id ? " active" : "")}
                onClick={() => setSelectedMap(m.id)}
              >
                {m.scope_name ?? m.name}
              </button>
            ))}
          </div>

          {active && (
            <div className="row" style={{ marginBottom: 12 }}>
              <input
                ref={replaceFileRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void replaceImage(active, file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={replacing}
                onClick={() => replaceFileRef.current?.click()}
              >
                {replacing ? "Replacing…" : "Replace image"}
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void deleteMap(active)}
              >
                Delete map
              </button>
            </div>
          )}
          {replaceError && (
            <div className="badge badge-bad" style={{ display: "block", marginBottom: 8 }}>
              {replaceError}
            </div>
          )}

          {active && <MapPlotter map={active} locations={locations} />}
        </>
      )}
    </div>
  );
}

function MapPlotter({
  map,
  locations,
}: {
  map: MarinaMapRow;
  locations: PickerLocation[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [addLocationId, setAddLocationId] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  const { data: rows } = usePlacements(map.id);
  // The stored shape is jsonb, so it arrives as text; parsed once per row here
  // rather than at each of the half-dozen places that read a coordinate.
  const placements = rows.map((p) => ({ ...p, shape: placementOf(p) }));
  const plottedIds = new Set(placements.map((p) => p.location_id));
  const imageUrl = attachmentUrl(map.image_path);

  const addPlacement = () => {
    if (!addLocationId) return;
    // Dropped mid-canvas at the default text size; drag to position.
    void createPlacement(map.id, addLocationId, { cx: 50, cy: 50, rotation: 0 });
    setAddLocationId("");
  };

  const updatePlacement = (placementId: string, patch: Partial<PlacementShape>) => {
    const existing = placements.find((p) => p.id === placementId);
    if (!existing) return;
    void savePlacement(placementId, { ...existing.shape, ...patch });
  };

  // Percentages of the rendered image, so a placement survives any display size.
  const pointToPercent = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    };
  };

  const onPointerDown = (e: React.PointerEvent, p: (typeof placements)[number]) => {
    e.preventDefault();
    const pt = pointToPercent(e.clientX, e.clientY);
    if (!pt) return;
    setSelected(p.id);
    dragRef.current = {
      id: p.id,
      offsetX: pt.x - p.shape.cx,
      offsetY: pt.y - p.shape.cy,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const pt = pointToPercent(e.clientX, e.clientY);
    if (!pt) return;
    updatePlacement(drag.id, {
      cx: clamp(pt.x - drag.offsetX),
      cy: clamp(pt.y - drag.offsetY),
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  const activePlacement = placements.find((p) => p.id === selected);

  return (
    <div className="grid-2">
      <div>
        <div
          ref={canvasRef}
          className="map-canvas map-schematic"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ touchAction: "none" }}
        >
          {imageUrl && (
            <img src={imageUrl} alt={map.name} className="map-image" draggable={false} />
          )}
          {placements.map((p) => (
            <button
              key={p.id}
              type="button"
              className="map-rect"
              style={{
                ...placementStyle(p.shape),
                background: "var(--accent-soft)",
                color: "var(--accent)",
                borderColor: selected === p.id ? "var(--accent)" : "var(--line)",
                borderWidth: selected === p.id ? 2.5 : 1.5,
                cursor: "grab",
              }}
              onPointerDown={(e) => onPointerDown(e, p)}
            >
              {p.location_name}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>
          Drag a rectangle to position it; select one to size and rotate it.
        </p>
      </div>

      <div>
        <div className="section-title">Plot a location</div>
        <div className="row" style={{ marginBottom: 12, alignItems: "flex-start" }}>
          {/* Searchable rather than a flat option list: a marina's locations
              run to the hundreds, and "Slip 14" exists on every dock — the
              ancestor path is the only thing that tells them apart. */}
          <div style={{ flex: "1 1 220px", minWidth: 180 }}>
            <LocationPicker
              locations={locations.filter((l) => !plottedIds.has(l.id))}
              value={addLocationId}
              onChange={setAddLocationId}
              placeholder="Search locations to plot…"
              allowNone={false}
            />
          </div>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!addLocationId}
            onClick={addPlacement}
          >
            Add
          </button>
        </div>

        {activePlacement ? (
          <div className="card">
            <div className="card-title">{activePlacement.location_name}</div>
            {(
              [
                ["fontSize", "Font size (px)", 8, 32, DEFAULT_PLACEMENT_STYLE.fontSize],
                ["paddingX", "Padding, left/right (px)", 0, 24, DEFAULT_PLACEMENT_STYLE.paddingX],
                ["paddingY", "Padding, top/bottom (px)", 0, 24, DEFAULT_PLACEMENT_STYLE.paddingY],
                ["rotation", "Rotation °", -180, 180, 0],
              ] as const
            ).map(([key, label, min, max, fallback]) => (
              <div className="field" key={key}>
                <span className="field-label">{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  value={activePlacement.shape[key] ?? fallback}
                  onChange={(e) =>
                    updatePlacement(activePlacement.id, {
                      [key]: Number(e.target.value),
                    } as Partial<PlacementShape>)
                  }
                  style={{ width: "100%" }}
                />
                <span className="muted small">
                  {activePlacement.shape[key] ?? fallback}
                </span>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => {
                // Removes just this one placement — the same location stays
                // plotted on any other map.
                void deletePlacement(activePlacement.id);
                setSelected(null);
              }}
            >
              Unplot from this map
            </button>
          </div>
        ) : (
          <span className="muted small">
            Select a rectangle on the map to adjust its size and rotation.
          </span>
        )}
      </div>
    </div>
  );
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}
