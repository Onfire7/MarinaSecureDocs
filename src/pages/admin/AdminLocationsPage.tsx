import { useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { db, id } from "../../lib/db";
import {
  compareNames,
  statusLabel,
  STANDARD_STATUSES,
  DEFAULT_POST_RESERVATION_STATUS,
  DEFAULT_PLACEMENT_STYLE,
  placementStyle,
  type PlacementShape,
} from "../../lib/locations";
import { LocationPicker, type PickerLocation } from "../shared/LocationPicker";
import { NameGeneratorDialog } from "./NameGeneratorDialog";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";
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

type Tab = "types" | "locations" | "maps";

function LocationsAdmin() {
  const [tab, setTab] = useState<Tab>("locations");

  return (
    <div>
      <AdminHeader title="Location Types & Locations" />

      <div className="chip-row">
        {(["types", "locations", "maps"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            className={"chip" + (tab === t ? " active" : "")}
            onClick={() => setTab(t)}
          >
            {t === "types" ? "Location types" : t === "locations" ? "Locations & checkpoints" : "Maps & plotting"}
          </button>
        ))}
      </div>

      {tab === "types" && <TypesTab />}
      {tab === "locations" && <LocationsTab />}
      {tab === "maps" && <MapsTab />}
    </div>
  );
}

// ---------------------------------------------------------------- Types

function TypesTab() {
  const [name, setName] = useState("");
  const { data } = db.useQuery({
    locationTypes: { validParentTypes: {}, locations: {} },
  });
  const types = useMemo(
    () => [...(data?.locationTypes ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  const add = async () => {
    if (!name.trim()) return;
    await db.transact(
      db.tx.locationTypes[id()].update({
        name: name.trim(),
        allowsReservations: false,
        hasBoat: false,
        hasVehicle: false,
        tracksStatus: false,
      }),
    );
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
          const inUse = (t.locations ?? []).length;
          const update = (fields: Record<string, unknown>) =>
            void db.transact(db.tx.locationTypes[t.id].update(fields));
          const parentIds = (t.validParentTypes ?? []).map((p) => p.id);

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
                  onClick={() => void db.transact(db.tx.locationTypes[t.id].delete())}
                >
                  Delete
                </button>
              </div>

              <div className="row" style={{ flexWrap: "wrap", marginTop: 8 }}>
                {(
                  [
                    ["tracksStatus", "Tracks occupancy status"],
                    ["allowsReservations", "Can accept reservations"],
                    ["hasBoat", "Holds a boat"],
                    ["hasVehicle", "Holds a vehicle"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="row" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(t[key])}
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
                            void db.transact(
                              e.target.checked
                                ? db.tx.locationTypes[t.id].link({ validParentTypes: o.id })
                                : db.tx.locationTypes[t.id].unlink({ validParentTypes: o.id }),
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

  const { data } = db.useQuery({
    locations: { type: {}, parent: {}, checkpoints: {} },
    locationTypes: {},
  });
  const locations = useMemo(
    () => [...(data?.locations ?? [])].sort((a, b) => compareNames(a.name, b.name)),
    [data],
  );
  const types = data?.locationTypes ?? [];

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, typeof locations>();
    for (const l of locations) {
      const key = l.parent?.id ?? null;
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
      let cursor = byId.get(mid)?.parent?.id;
      let guard = 0;
      while (cursor && guard++ < 30) {
        visible.add(cursor);
        cursor = byId.get(cursor)?.parent?.id;
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
      {locations.filter((l) => !l.parent).length === 0 && locations.length === 0 && (
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

type LocationRowType = {
  id: string;
  name: string;
  status?: string;
  reservationEnabled: boolean;
  reservationVisibility?: string | null;
  postReservationStatus?: string | null;
  gpsLat?: number;
  gpsLng?: number;
  type?: {
    id: string;
    name: string;
    allowsReservations?: boolean;
    tracksStatus?: boolean;
  } | null;
  parent?: { id: string; name: string } | null;
  checkpoints?: { id: string; name: string; guidUrl: string; gpsValidationRadius?: number }[];
};

function LocationRow({
  location,
  types,
  allLocations,
  depth,
  childCount,
  hasChildren,
  isOpen,
  highlighted,
  expanded,
  onSelect,
}: {
  location: LocationRowType;
  types: {
    id: string;
    name: string;
    allowsReservations?: boolean;
    tracksStatus?: boolean;
  }[];
  allLocations: PickerLocation[];
  depth: number;
  childCount: number;
  hasChildren: boolean;
  isOpen: boolean;
  highlighted: boolean;
  expanded: boolean;
  onSelect: () => void;
}) {
  const update = (fields: Record<string, unknown>) =>
    void db.transact(db.tx.locations[location.id].update(fields));

  const locationType = types.find((t) => t.id === location.type?.id);
  const typeAllowsReservations = locationType?.allowsReservations;
  const tracksStatus = Boolean(locationType?.tracksStatus ?? location.type?.tracksStatus);

  // Named after its location and renamed inline on the row below if that's
  // wrong — which it rarely is, since a checkpoint is nearly always "the
  // checkpoint at <this location>". Prompting first made every one of them a
  // modal round-trip for a name the admin had just typed.
  const addCheckpoint = async () => {
    const existing = (location.checkpoints ?? []).length;
    await db.transact(
      db.tx.checkpoints[id()]
        .update({
          name: existing === 0 ? location.name : `${location.name} ${existing + 1}`,
          // Auto-generated, never user-entered — this is the value the
          // physical NFC tag / QR code encodes.
          guidUrl: crypto.randomUUID(),
          // Defaults from the location; per-checkpoint GPS radius falls back
          // to the marina default until overridden.
          ...(location.gpsLat != null ? { gpsLat: location.gpsLat } : {}),
          ...(location.gpsLng != null ? { gpsLng: location.gpsLng } : {}),
        })
        .link({ location: location.id }),
    );
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
              {location.type?.name ?? "No type"}
              {tracksStatus && ` · ${statusLabel(location.status)}`}
              {/* Say what's inside before you open it. */}
              {hasChildren && ` · ${childCount} inside`}
              {(location.checkpoints ?? []).length > 0 &&
                ` · ${(location.checkpoints ?? []).length} checkpoint(s)`}
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
                    value={location.status ?? "vacant"}
                    onChange={(e) => update({ status: e.target.value })}
                  >
                    {[
                      ...new Set([...STANDARD_STATUSES, location.status ?? "vacant"]),
                    ].map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="field">
                <span className="field-label">Parent</span>
                <LocationPicker
                  locations={allLocations}
                  value={location.parent?.id ?? ""}
                  excludeId={location.id}
                  onChange={(parentId) =>
                    void db.transact(
                      parentId
                        ? db.tx.locations[location.id].link({ parent: parentId })
                        : location.parent
                          ? db.tx.locations[location.id].unlink({
                              parent: location.parent.id,
                            })
                          : db.tx.locations[location.id].update({}),
                    )
                  }
                />
              </div>
              <div className="field">
                <span className="field-label">GPS coordinates</span>
                <div className="row">
                  <DraftNumberInput
                    className="input select-inline"
                    placeholder="lat"
                    aria-label="Latitude"
                    value={location.gpsLat}
                    onCommit={(gpsLat) => update({ gpsLat })}
                  />
                  <DraftNumberInput
                    className="input select-inline"
                    placeholder="lng"
                    aria-label="Longitude"
                    value={location.gpsLng}
                    onCommit={(gpsLng) => update({ gpsLng })}
                  />
                </div>
              </div>

              {typeAllowsReservations && (
                <div className="field">
                  <span className="field-label">Reservations</span>
                  <label className="row" style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={location.reservationEnabled}
                      onChange={(e) =>
                        update({
                          reservationEnabled: e.target.checked,
                          ...(e.target.checked && !location.postReservationStatus
                            ? { postReservationStatus: DEFAULT_POST_RESERVATION_STATUS }
                            : {}),
                        })
                      }
                    />
                    <span className="small">Accepts reservations</span>
                  </label>
                  {location.reservationEnabled && (
                    <div className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                      <select
                        className="select select-inline"
                        value={location.reservationVisibility ?? "public"}
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
                        value={
                          location.postReservationStatus ??
                          DEFAULT_POST_RESERVATION_STATUS
                        }
                        onChange={(e) =>
                          update({ postReservationStatus: e.target.value })
                        }
                      >
                        {[
                          ...new Set([
                            ...STANDARD_STATUSES,
                            location.postReservationStatus ??
                              DEFAULT_POST_RESERVATION_STATUS,
                          ]),
                        ].map((s) => (
                          <option key={s} value={s}>
                            {statusLabel(s)}
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
                {(location.checkpoints ?? []).map((cp) => (
                  <CheckpointRow key={cp.id} checkpoint={cp} />
                ))}
                {(location.checkpoints ?? []).length === 0 && (
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
  const { data, isLoading } = db.useQuery({
    locations: {
      $: { where: { id: locationId } },
      children: {},
      checkpoints: {},
      currentBoat: {},
      currentVehicle: {},
      maps: {},
      mapPlacements: {},
      notes: {},
      incidents: {},
      tickets: {},
      reservations: {},
      leases: {},
    },
  });

  const l = data?.locations?.[0];

  const blockers: string[] = [];
  if (l) {
    const count = (rows?: unknown[]) => rows?.length ?? 0;
    const add = (n: number, singular: string, plural = `${singular}s`) => {
      if (n > 0) blockers.push(`${n} ${n === 1 ? singular : plural}`);
    };
    add(count(l.children), "child location", "child locations");
    add(count(l.checkpoints), "checkpoint");
    add(count(l.maps), "map scoped to it", "maps scoped to it");
    add(count(l.leases), "lease");
    add(count(l.reservations), "reservation");
    add(count(l.incidents), "incident");
    add(count(l.tickets), "ticket");
    add(count(l.notes), "note");
    if (l.currentBoat) blockers.push("a boat berthed here");
    if (l.currentVehicle) blockers.push("a vehicle parked here");
  }

  const placements = l?.mapPlacements ?? [];

  const remove = async () => {
    const extra =
      placements.length > 0
        ? ` It's plotted on ${placements.length} map${placements.length === 1 ? "" : "s"}; those placements go too.`
        : "";
    if (!window.confirm(`Delete "${name}"?${extra} This can't be undone.`)) return;
    await db.transact([
      db.tx.locations[locationId].delete(),
      ...placements.map((p) => db.tx.locationMapPlacements[p.id].delete()),
    ]);
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

function CheckpointRow({
  checkpoint,
}: {
  checkpoint: { id: string; name: string; guidUrl: string; gpsValidationRadius?: number };
}) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/checkin/${checkpoint.guidUrl}`;

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
          onCommit={(name) =>
            void db.transact(db.tx.checkpoints[checkpoint.id].update({ name }))
          }
        />
        <div className="row">
          {/* The only place the GUID URL is exposed — deliberately not on
              Checkpoint detail. */}
          <button type="button" className="btn btn-sm" onClick={() => void copy()}>
            {copied ? "Copied ✓" : "Copy URL"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() => void db.transact(db.tx.checkpoints[checkpoint.id].delete())}
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
          value={checkpoint.gpsValidationRadius}
          onCommit={(gpsValidationRadius) =>
            void db.transact(
              db.tx.checkpoints[checkpoint.id].update({ gpsValidationRadius }),
            )
          }
        />
      </div>
      <code className="small muted" style={{ wordBreak: "break-all" }}>
        {url}
      </code>
    </div>
  );
}

function CreateLocationDialog({
  types,
  locations,
  onClose,
}: {
  types: { id: string; name: string; tracksStatus?: boolean }[];
  locations: PickerLocation[];
  onClose: () => void;
}) {
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
          .filter((l) => (l.parent?.id ?? "") === parentId)
          .map((l) => l.name.toLowerCase()),
      ),
    [locations, parentId],
  );
  const duplicates = parsedNames.filter((n) => existingNames.has(n.toLowerCase()));

  const create = async () => {
    if (parsedNames.length === 0 || !typeId) return;
    setSaving(true);
    // Only types that track status get one — a container with a "Vacant"
    // label is exactly the confusion this avoids.
    const tracksStatus = Boolean(types.find((t) => t.id === typeId)?.tracksStatus);
    await db.transact(
      parsedNames.flatMap((name) => {
        const locationId = id();
        return [
          db.tx.locations[locationId]
            .update({
              name,
              reservationEnabled: false,
              ...(tracksStatus ? { status: "vacant" } : {}),
            })
            .link({ type: typeId, ...(parentId ? { parent: parentId } : {}) }),
          // guidUrl is auto-generated, never user-entered — it's the value
          // the physical NFC tag / QR code encodes.
          ...(withCheckpoints
            ? [
                db.tx.checkpoints[id()]
                  .update({ name, guidUrl: crypto.randomUUID() })
                  .link({ location: locationId }),
              ]
            : []),
        ];
      }),
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

// db.storage.uploadFile doesn't expose an AbortSignal, so the browser
// fetch() underneath it has no timeout of its own — a stalled connection
// (as opposed to a rejected response, which the SDK does surface) would
// otherwise hang indefinitely. Racing it against a timeout guarantees the
// caller's spinner always resolves to an error. Shared by both new-map
// upload and replace-image so there's one upload path, not two.
async function uploadFileWithTimeout(path: string, file: File): Promise<string> {
  const result = await Promise.race([
    db.storage.uploadFile(path, file),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Upload timed out after 45s — check your connection and try again.")),
        UPLOAD_TIMEOUT_MS,
      ),
    ),
  ]);
  return result.data.id;
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

  const { data } = db.useQuery({
    marinaMaps: { scope: {}, image: {}, placements: { location: {} } },
    locations: { parent: {}, type: {} },
  });
  const maps = data?.marinaMaps ?? [];
  const locations = useMemo(
    () => [...(data?.locations ?? [])].sort((a, b) => compareNames(a.name, b.name)),
    [data],
  );
  const roots = locations.filter((l) => !l.parent);
  const active = maps.find((m) => m.id === selectedMap) ?? maps[0];

  const upload = async (file: File) => {
    // Scope is required before the upload completes — there's no way to
    // create an unscoped map.
    if (!scopeId) return;
    setUploading(true);
    setUploadError(null);
    try {
      const path = `marina-maps/${Date.now()}-${file.name}`;
      const fileId = await uploadFileWithTimeout(path, file);
      const mapId = id();
      await db.transact(
        db.tx.marinaMaps[mapId]
          .update({ name: mapName.trim() || file.name })
          .link({ scope: scopeId, image: fileId }),
      );
      setSelectedMap(mapId);
      setMapName("");
      setScopeId("");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  // $files has no update perm (instant.perms.ts:89), so "replacing" an
  // image is upload-new → relink → delete-old, not an overwrite.
  const replaceImage = async (map: NonNullable<typeof active>, file: File) => {
    setReplacing(true);
    setReplaceError(null);
    try {
      const path = `marina-maps/${Date.now()}-${file.name}`;
      const newFileId = await uploadFileWithTimeout(path, file);
      const oldImageId = map.image?.id;
      await db.transact([
        db.tx.marinaMaps[map.id].link({ image: newFileId }),
        ...(oldImageId ? [db.tx.$files[oldImageId].delete()] : []),
      ]);
    } catch (err) {
      setReplaceError(err instanceof Error ? err.message : "Replace failed.");
    } finally {
      setReplacing(false);
    }
  };

  const deleteMap = async (map: NonNullable<typeof active>) => {
    const placementCount = map.placements?.length ?? 0;
    const confirmed = window.confirm(
      `Delete "${map.scope?.name ?? map.name}"? This removes the map image` +
        (placementCount > 0
          ? ` and unplots ${placementCount} location${placementCount === 1 ? "" : "s"} from it — those placements can't be recovered`
          : "") +
        `.`,
    );
    if (!confirmed) return;
    const imageId = map.image?.id;
    await db.transact([
      db.tx.marinaMaps[map.id].delete(),
      ...(imageId ? [db.tx.$files[imageId].delete()] : []),
      ...(map.placements ?? []).map((p) => db.tx.locationMapPlacements[p.id].delete()),
    ]);
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
                {m.scope?.name ?? m.name}
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
  map: {
    id: string;
    name: string;
    image?: { url: string } | null;
    placements?: {
      id: string;
      placement: PlacementShape;
      location?: { id: string; name: string } | null;
    }[];
  };
  locations: PickerLocation[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [addLocationId, setAddLocationId] = useState("");
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  const placements = map.placements ?? [];
  const plottedIds = new Set(
    placements.map((p) => p.location?.id).filter(Boolean) as string[],
  );

  const addPlacement = () => {
    if (!addLocationId) return;
    void db.transact(
      db.tx.locationMapPlacements[id()]
        // Dropped mid-canvas at the default text size; drag to position.
        .update({ placement: { cx: 50, cy: 50, rotation: 0 } })
        .link({ map: map.id, location: addLocationId }),
    );
    setAddLocationId("");
  };

  const updatePlacement = (placementId: string, patch: Partial<PlacementShape>) => {
    const existing = placements.find((p) => p.id === placementId);
    if (!existing) return;
    void db.transact(
      db.tx.locationMapPlacements[placementId].update({
        placement: { ...existing.placement, ...patch },
      }),
    );
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
      offsetX: pt.x - p.placement.cx,
      offsetY: pt.y - p.placement.cy,
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
          {map.image?.url && (
            <img src={map.image.url} alt={map.name} className="map-image" draggable={false} />
          )}
          {placements.map((p) => (
            <button
              key={p.id}
              type="button"
              className="map-rect"
              style={{
                ...placementStyle(p.placement),
                background: "var(--accent-soft)",
                color: "var(--accent)",
                borderColor: selected === p.id ? "var(--accent)" : "var(--line)",
                borderWidth: selected === p.id ? 2.5 : 1.5,
                cursor: "grab",
              }}
              onPointerDown={(e) => onPointerDown(e, p)}
            >
              {p.location?.name}
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
            <div className="card-title">{activePlacement.location?.name}</div>
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
                  value={activePlacement.placement[key] ?? fallback}
                  onChange={(e) =>
                    updatePlacement(activePlacement.id, {
                      [key]: Number(e.target.value),
                    } as Partial<PlacementShape>)
                  }
                  style={{ width: "100%" }}
                />
                <span className="muted small">
                  {activePlacement.placement[key] ?? fallback}
                </span>
              </div>
            ))}
            <button
              type="button"
              className="btn btn-sm btn-danger"
              onClick={() => {
                // Removes just this one placement — the same location stays
                // plotted on any other map.
                void db.transact(
                  db.tx.locationMapPlacements[activePlacement.id].delete(),
                );
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
