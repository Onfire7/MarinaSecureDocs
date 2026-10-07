import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { SchematicMapView } from "../shared/SchematicMapView";
import {
  compareNames,
  statusBadgeClass,
  statusMapColors,
} from "../../lib/locations";
import {
  setLocationStatus,
  tracksStatus,
  useLocations,
  useLocationTypes,
  useMarinaMaps,
  type LocationRow,
} from "../../data/locations";
import { useLocationStatuses } from "../../data/lookups";

// Locations — Location List / Map View (LocationListPage.spec.md).
// Two presentations of the same filtered set: the marina map (the image
// with each location's label and anchor) and a hierarchy list. The map is
// the landing view whenever the marina has one (owner, 2026-10-07). A
// relative GPS "pin map" lived here until 2026-10-07; tile-map support
// for the regular maps is the planned replacement (docs/ROADMAP.md).
type ViewMode = "map" | "list";

export function LocationListPage() {
  const current = useCurrent();
  const canManage = current.can("manage_locations");
  // null until someone chooses: the map where there is one, else the list.
  const [chosen, setChosen] = useState<ViewMode | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: locations } = useLocations();
  const { data: types } = useLocationTypes();
  const { data: maps } = useMarinaMaps();
  const { statuses } = useLocationStatuses();
  const hasSchematic = maps.length > 0;
  const view: ViewMode = chosen ?? (hasSchematic ? "map" : "list");
  const setView = setChosen;

  const filtered = locations.filter(
    (l) =>
      (!typeFilter || l.location_type_id === typeFilter) &&
      (!statusFilter || l.status_id === statusFilter),
  );
  const filterActive = Boolean(typeFilter || statusFilter);

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Locations</h1>
        {canManage && (
          <Link to="/admin" className="btn btn-sm">
            + Add location
          </Link>
        )}
      </div>

      <div className="chip-row">
        {(["map", "list"] as ViewMode[])
          .filter((m) => m !== "map" || hasSchematic)
          .map((m) => (
            <button
              key={m}
              type="button"
              className={"chip" + (view === m ? " active" : "")}
              onClick={() => setView(m)}
            >
              {m === "map" ? "Map" : "List"}
            </button>
          ))}
        <select
          className="select select-inline"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{ marginLeft: "auto" }}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          className="select select-inline"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {locations.length === 0 ? (
        <div className="placeholder">
          <div className="big">No locations defined yet</div>
          {canManage ? (
            <Link to="/admin">Set up location types and locations in Admin →</Link>
          ) : (
            "Nothing here yet."
          )}
        </div>
      ) : view === "list" ? (
        <ListView locations={filtered} flat={filterActive} canManage={canManage} />
      ) : (
        <SchematicMap locations={filtered} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- List

function ListView({
  locations,
  flat,
  canManage,
}: {
  locations: LocationRow[];
  flat: boolean;
  canManage: boolean;
}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  // Mobile drills level by level; desktop shows the whole indented tree.
  const [drillStack, setDrillStack] = useState<LocationRow[]>([]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, LocationRow[]>();
    for (const l of locations) {
      const key = l.parent_id ?? null;
      const list = m.get(key) ?? [];
      list.push(l);
      m.set(key, list);
    }
    for (const list of m.values()) list.sort((a, b) => compareNames(a.name, b.name));
    return m;
  }, [locations]);

  if (flat) {
    const sorted = [...locations].sort((a, b) => compareNames(a.name, b.name));
    return (
      <div className="stack">
        {sorted.map((l) => (
          <LocationCard key={l.id} location={l} canManage={canManage} />
        ))}
        {sorted.length === 0 && (
          <div className="placeholder">
            <div className="big">No locations match these filters</div>
          </div>
        )}
      </div>
    );
  }

  if (isMobile) {
    const parent = drillStack.at(-1) ?? null;
    const level = childrenOf.get(parent?.id ?? null) ?? [];
    return (
      <div>
        {parent && (
          <div className="row" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setDrillStack(drillStack.slice(0, -1))}
            >
              ← {drillStack.at(-2)?.name ?? "All locations"}
            </button>
            <span className="muted small">{parent.name}</span>
          </div>
        )}
        <div className="stack">
          {level.map((l) => {
            const kids = childrenOf.get(l.id) ?? [];
            return (
              <LocationCard
                key={l.id}
                location={l}
                canManage={canManage}
                childCount={kids.length}
                // A location with no children is a drill-in dead end — tapping
                // it opens its details instead, rather than doing nothing.
                onDrill={
                  kids.length > 0
                    ? () => setDrillStack([...drillStack, l])
                    : () => navigate(`/locations/${l.id}`)
                }
              />
            );
          })}
        </div>
      </div>
    );
  }

  const renderLevel = (parentId: string | null, depth: number): ReactNode =>
    (childrenOf.get(parentId) ?? []).map((l) => (
      <div key={l.id} style={{ marginLeft: depth * 20 }}>
        <LocationCard
          location={l}
          canManage={canManage}
          childCount={(childrenOf.get(l.id) ?? []).length}
        />
        {renderLevel(l.id, depth + 1)}
      </div>
    ));

  return <div className="stack" style={{ gap: 8 }}>{renderLevel(null, 0)}</div>;
}

function LocationCard({
  location,
  canManage,
  childCount = 0,
  onDrill,
}: {
  location: LocationRow;
  canManage: boolean;
  childCount?: number;
  onDrill?: () => void;
}) {
  const current = useCurrent();
  const { statuses } = useLocationStatuses();
  const setStatus = (statusId: string) => {
    const status = statuses.find((s) => s.id === statusId);
    if (status) void setLocationStatus(location, status, current.user?.id ?? null);
  };
  const body = (
    <>
      <div>
        <div className="card-title">{location.name}</div>
        <div className="card-meta">
          {location.type_name}
          {childCount > 0 &&
            ` · ${childCount} ${childCount === 1 ? "child" : "children"}`}
          {location.boat_name && ` · Boat: ${location.boat_name}`}
          {location.vehicle_description &&
            ` · Vehicle: ${location.vehicle_description}`}
        </div>
      </div>
      <div className="row">
        {!tracksStatus(location) ? null : canManage ? (
          <select
            className="select select-inline"
            value={location.status_id ?? ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setStatus(e.target.value)}
          >
            {/* A location whose status row was retired keeps showing it, so
                that opening this menu is not itself an edit. */}
            {!location.status_id && <option value="">—</option>}
            {location.status_id &&
              !statuses.some((s) => s.id === location.status_id) && (
                <option value={location.status_id}>
                  {location.status_name ?? "—"}
                </option>
              )}
            {statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        ) : (
          <span className={statusBadgeClass(location.status_name)}>
            {location.status_name ?? "—"}
          </span>
        )}
        <Link
          to={`/locations/${location.id}`}
          className="btn btn-sm btn-quiet"
          onClick={(e) => e.stopPropagation()}
        >
          Details
        </Link>
      </div>
    </>
  );
  return onDrill ? (
    <div className="card spread" style={{ cursor: "pointer" }} onClick={onDrill}>
      {body}
    </div>
  ) : (
    <div className="card spread">{body}</div>
  );
}

// ---------------------------------------------------------------- Map

/** The marina map, interactive and read-only: zoom it, flip anchors and
 *  labels, tap a location to see what it is and its status, tap it again -
 *  or Open - to go to it. Editing is the admin plotter's; nothing here
 *  writes. The type and status filters apply to it as to the other views. */
function SchematicMap({ locations }: { locations: LocationRow[] }) {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const byId = new Map(locations.map((l) => [l.id, l]));
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <SchematicMapView
        colorFor={(locationId) => {
          const c = statusMapColors(byId.get(locationId)?.status_name ?? "");
          return locationId === selectedId ? { ...c, border: "var(--accent)" } : c;
        }}
        include={(locationId) => byId.has(locationId)}
        onOpen={(locationId) => (locationId === selectedId ? navigate(`/locations/${locationId}`) : setSelectedId(locationId))}
        footnote="Tap a location to see it, tap it again to open it. Rectangles are colored by status. A ▸ marker drills into that location's own map."
      />
      {selected && (
        <div className="card spread" data-testid="map-selected">
          <span style={{ minWidth: 0 }}>
            <span className="card-title">{selected.name}</span>
            <span className="card-meta" style={{ display: "block" }}>
              {selected.type_name}
            </span>
          </span>
          <span className="row">
            {selected.tracks_status === 1 && <span className={statusBadgeClass(selected.status_name)}>{selected.status_name ?? "—"}</span>}
            <Link to={`/locations/${selected.id}`} className="btn btn-sm btn-primary">
              Open
            </Link>
            <button type="button" className="btn btn-sm btn-bare" aria-label="Close" onClick={() => setSelectedId(null)}>
              ✕
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
