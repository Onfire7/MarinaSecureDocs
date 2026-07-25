import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import {
  STANDARD_STATUSES,
  compareNames,
  statusBadgeClass,
  statusLabel,
  statusMapColors,
} from "../../lib/locations";

// Locations — Location List / Map View (see pages/location-list.html).
// Three presentations of the same filtered set: hierarchy list, geographic
// pin map (gps coordinates), and schematic map (MarinaMap image +
// LocationMapPlacement rectangles).
type ViewMode = "list" | "pins" | "schematic";

type LocationRow = {
  id: string;
  name: string;
  status: string;
  reservationEnabled: boolean;
  gpsLat?: number;
  gpsLng?: number;
  type?: { id: string; name: string } | null;
  parent?: { id: string } | null;
  currentBoat?: { id: string; name: string } | null;
  currentVehicle?: { id: string; description: string } | null;
};

export function LocationListPage() {
  const current = useCurrent();
  const canManage = current.can("manage_locations");
  const [view, setView] = useState<ViewMode>("list");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data } = db.useQuery({
    locations: { type: {}, parent: {}, currentBoat: {}, currentVehicle: {} },
    locationTypes: {},
    marinaMaps: { scope: { parent: {} }, image: {}, placements: { location: {} } },
  });

  const locations = useMemo(
    () => (data?.locations ?? []) as LocationRow[],
    [data],
  );
  const types = data?.locationTypes ?? [];
  const maps = data?.marinaMaps ?? [];
  const hasSchematic = maps.length > 0;

  const statuses = useMemo(() => {
    const set = new Set<string>(STANDARD_STATUSES);
    for (const l of locations) set.add(l.status);
    return [...set];
  }, [locations]);

  const filtered = locations.filter(
    (l) =>
      (!typeFilter || l.type?.id === typeFilter) &&
      (!statusFilter || l.status === statusFilter),
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
            <option key={s} value={s}>
              {statusLabel(s)}
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
        <SchematicMap maps={maps} />
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
  // Mobile drills level by level; desktop shows the whole indented tree.
  const [drillStack, setDrillStack] = useState<LocationRow[]>([]);

  const childrenOf = useMemo(() => {
    const m = new Map<string | null, LocationRow[]>();
    for (const l of locations) {
      const key = l.parent?.id ?? null;
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
                onDrill={
                  kids.length > 0 ? () => setDrillStack([...drillStack, l]) : undefined
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
  const setStatus = (status: string) => {
    void db.transact(db.tx.locations[location.id].update({ status }));
  };
  const body = (
    <>
      <div>
        <div className="card-title">{location.name}</div>
        <div className="card-meta">
          {location.type?.name}
          {childCount > 0 &&
            ` · ${childCount} ${childCount === 1 ? "child" : "children"}`}
          {location.currentBoat && ` · Boat: ${location.currentBoat.name}`}
          {location.currentVehicle && ` · Vehicle: ${location.currentVehicle.description}`}
        </div>
      </div>
      <div className="row">
        {canManage ? (
          <select
            className="select select-inline"
            value={location.status}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[...new Set([...STANDARD_STATUSES, location.status])].map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        ) : (
          <span className={statusBadgeClass(location.status)}>
            {statusLabel(location.status)}
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
  const pinned = locations.filter((l) => l.gpsLat != null && l.gpsLng != null);
  if (pinned.length === 0) {
    return (
      <div className="placeholder">
        <div className="big">No locations have GPS coordinates yet</div>
        Coordinates are set per location in Admin → Locations.
      </div>
    );
  }
  const lats = pinned.map((l) => l.gpsLat!);
  const lngs = pinned.map((l) => l.gpsLng!);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const span = (v: number, min: number, max: number) =>
    max === min ? 50 : ((v - min) / (max - min)) * 90 + 5;

  return (
    <div className="map-canvas">
      {pinned.map((l) => {
        const colors = statusMapColors(l.status);
        return (
          <button
            key={l.id}
            type="button"
            className="map-pin"
            style={{
              left: `${span(l.gpsLng!, minLng, maxLng)}%`,
              // north up: higher latitude renders nearer the top
              top: `${100 - span(l.gpsLat!, minLat, maxLat)}%`,
              background: colors.background,
              borderColor: colors.border,
            }}
            title={`${l.name} — ${statusLabel(l.status)}`}
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

type MapRecord = {
  id: string;
  name: string;
  scope?: { id: string; name: string; parent?: { id: string } | null } | null;
  image?: { url: string } | null;
  placements?: {
    id: string;
    // Center + dimensions as percentages (0–100) of the map image,
    // rotation in degrees clockwise (see data-model — LocationMapPlacement).
    placement: {
      cx: number;
      cy: number;
      width: number;
      height: number;
      rotation: number;
    };
    location?: { id: string; name: string; status: string } | null;
  }[];
};

function SchematicMap({ maps }: { maps: MapRecord[] }) {
  const navigate = useNavigate();
  const [mapStack, setMapStack] = useState<MapRecord[]>([]);

  const rootMaps = maps.filter((m) => !m.scope?.parent);
  const mapForLocation = (locationId: string) =>
    maps.find((m) => m.scope?.id === locationId);

  const active =
    mapStack.at(-1) ?? (rootMaps.length === 1 ? rootMaps[0] : undefined);

  // Multi-property marina: choose which root overview map to open first.
  if (!active) {
    return (
      <div className="stack">
        <div className="section-title">Choose a property</div>
        {rootMaps.map((m) => (
          <button
            key={m.id}
            type="button"
            className="card spread"
            style={{ cursor: "pointer", textAlign: "left", font: "inherit" }}
            onClick={() => setMapStack([m])}
          >
            <span className="card-title">{m.scope?.name ?? m.name}</span>
            <span className="muted small">{m.placements?.length ?? 0} plotted</span>
          </button>
        ))}
        {rootMaps.length === 0 && (
          <div className="placeholder">
            <div className="big">No overview map uploaded yet</div>
            Maps are uploaded and plotted in Admin → Locations.
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        {(mapStack.length > 1 || (mapStack.length === 1 && rootMaps.length > 1)) && (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => setMapStack(mapStack.slice(0, -1))}
          >
            ← Back
          </button>
        )}
        <span className="section-title" style={{ marginBottom: 0 }}>
          {active.scope?.name ?? active.name}
        </span>
      </div>

      <div className="map-canvas map-schematic">
        {active.image?.url && (
          <img src={active.image.url} alt={active.name} className="map-image" />
        )}
        {(active.placements ?? []).map((p) => {
          if (!p.location) return null;
          const colors = statusMapColors(p.location.status);
          const childMap = mapForLocation(p.location.id);
          return (
            <button
              key={p.id}
              type="button"
              className="map-rect"
              style={{
                left: `${p.placement.cx}%`,
                top: `${p.placement.cy}%`,
                width: `${p.placement.width}%`,
                height: `${p.placement.height}%`,
                transform: `translate(-50%, -50%) rotate(${p.placement.rotation ?? 0}deg)`,
                background: colors.background,
                borderColor: colors.border,
              }}
              title={`${p.location.name} — ${statusLabel(p.location.status)}`}
              onClick={() =>
                childMap
                  ? setMapStack([...mapStack, childMap])
                  : navigate(`/locations/${p.location!.id}`)
              }
            >
              {p.location.name}
              {childMap && " ▸"}
            </button>
          );
        })}
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        Rectangles are color-coded by status. A ▸ marker drills into that
        location's own detail map; anything else opens the location.
      </p>
    </div>
  );
}
