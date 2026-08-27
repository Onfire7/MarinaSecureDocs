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

// Locations — Location List / Map View (see pages/location-list.html).
// Three presentations of the same filtered set: hierarchy list, geographic
// pin map (gps coordinates), and schematic map (MarinaMap image +
// LocationMapPlacement rectangles).
type ViewMode = "list" | "pins" | "schematic";

export function LocationListPage() {
  const current = useCurrent();
  const canManage = current.can("manage_locations");
  const [view, setView] = useState<ViewMode>("list");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: locations } = useLocations();
  const { data: types } = useLocationTypes();
  const { data: maps } = useMarinaMaps();
  const { statuses } = useLocationStatuses();
  const hasSchematic = maps.length > 0;

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
        {(["list", "pins", "schematic"] as ViewMode[])
          .filter((m) => m !== "schematic" || hasSchematic)
          .map((m) => (
            <button
              key={m}
              type="button"
              className={"chip" + (view === m ? " active" : "")}
              onClick={() => setView(m)}
            >
              {m === "list" ? "List" : m === "pins" ? "Pin Map" : "Schematic"}
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
      ) : view === "pins" ? (
        <PinMap locations={filtered} />
      ) : (
        <SchematicMap locations={locations} />
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

// ---------------------------------------------------------------- Pin map

// Relative plot over the bounding box of the filtered set's gps coordinates —
// deliberately dependency-free rather than a tile-based live map; locations
// without coordinates are omitted from this mode but remain in the list.
function PinMap({ locations }: { locations: LocationRow[] }) {
  const navigate = useNavigate();
  const pinned = locations.filter((l) => l.gps_lat != null && l.gps_lng != null);
  if (pinned.length === 0) {
    return (
      <div className="placeholder">
        <div className="big">No locations have GPS coordinates yet</div>
        Coordinates are set per location in Admin → Locations.
      </div>
    );
  }
  const lats = pinned.map((l) => l.gps_lat!);
  const lngs = pinned.map((l) => l.gps_lng!);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const span = (v: number, min: number, max: number) =>
    max === min ? 50 : ((v - min) / (max - min)) * 90 + 5;

  return (
    <div className="map-canvas">
      {pinned.map((l) => {
        const colors = statusMapColors(l.status_name);
        return (
          <button
            key={l.id}
            type="button"
            className="map-pin"
            style={{
              left: `${span(l.gps_lng!, minLng, maxLng)}%`,
              // north up: higher latitude renders nearer the top
              top: `${100 - span(l.gps_lat!, minLat, maxLat)}%`,
              background: colors.background,
              borderColor: colors.border,
            }}
            title={`${l.name} — ${l.status_name ?? "—"}`}
            onClick={() => navigate(`/locations/${l.id}`)}
          >
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Schematic

function SchematicMap({ locations }: { locations: LocationRow[] }) {
  const navigate = useNavigate();
  const statusById = new Map(locations.map((l) => [l.id, l.status_name]));

  return (
    <SchematicMapView
      colorFor={(locationId) => statusMapColors(statusById.get(locationId) ?? "")}
      onOpen={(locationId) => navigate(`/locations/${locationId}`)}
      footnote="Rectangles are color-coded by status. A ▸ marker drills into that location's own detail map; anything else opens the location."
    />
  );
}
