import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { InstaQLEntity } from "@instantdb/react";
import { db, type AppSchema } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { DEFAULT_POST_RESERVATION_STATUS, statusLabel } from "../../lib/locations";
import {
  RESERVATION_STATUSES,
  rangesOverlap,
  reservationStatusBadgeClass,
  reservationTargetOf,
} from "../../lib/reservations";
import {
  SchematicMapView,
  type RectStyle,
} from "../shared/SchematicMapView";

// Reservations — Calendar / List (see docs/pages/reservation-list.html).
// One screen for every reservable target, Location or Asset alike. Browsing
// is unrestricted; only creating/editing needs manage_reservations.
type ViewMode = "list" | "calendar" | "week" | "map";

const RESERVATION_QUERY = {
  reservations: {
    contact: {},
    location: { type: {} },
    asset: {},
  },
  marinaMaps: {
    scope: { parent: {} },
    image: {},
    placements: { location: {} },
  },
  locations: {},
} as const;

export function ReservationListPage() {
  const current = useCurrent();
  const [view, setView] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const { data } = db.useQuery(RESERVATION_QUERY);
  const maps = data?.marinaMaps ?? [];
  const locationsById = useMemo(
    () => new Map((data?.locations ?? []).map((l) => [l.id, l])),
    [data],
  );

  const reservations = useMemo(
    () =>
      [...(data?.reservations ?? [])].sort((a, b) => {
        const at = a.expectedCheckin ? new Date(a.expectedCheckin).getTime() : Infinity;
        const bt = b.expectedCheckin ? new Date(b.expectedCheckin).getTime() : Infinity;
        return at - bt;
      }),
    [data],
  );

  const filtered = reservations.filter((r) => {
    const target = reservationTargetOf(r);
    if (statusFilter && r.status !== statusFilter) return false;
    if (kindFilter && target?.kind !== kindFilter) return false;
    const start = r.expectedCheckin ? new Date(r.expectedCheckin).getTime() : null;
    const end = r.expectedCheckout ? new Date(r.expectedCheckout).getTime() : start;
    if (fromDate && end != null && end < new Date(fromDate).getTime()) return false;
    if (toDate && start != null && start > new Date(toDate).getTime() + 24 * 3600_000)
      return false;
    return true;
  });

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Reservations</h1>
        {current.can("manage_reservations") && (
          <Link to="/reservations/new" className="btn btn-sm btn-primary">
            + New Reservation
          </Link>
        )}
      </div>

      <div className="chip-row">
        {(["list", "calendar", "week", "map"] as ViewMode[]).map((m) => (
          <button
            key={m}
            type="button"
            className={"chip" + (view === m ? " active" : "")}
            onClick={() => setView(m)}
          >
            {m === "list"
              ? "List"
              : m === "calendar"
                ? "Calendar"
                : m === "week"
                  ? "Week"
                  : "Map"}
          </button>
        ))}
        <select
          className="select select-inline"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {RESERVATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        <select
          className="select select-inline"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
        >
          <option value="">Locations & assets</option>
          <option value="location">Locations</option>
          <option value="asset">Assets</option>
        </select>
        <input
          type="date"
          className="input select-inline"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          title="From"
        />
        <input
          type="date"
          className="input select-inline"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          title="To"
        />
      </div>

      {view === "list" && <ListView reservations={filtered} />}
      {view === "calendar" && <CalendarView reservations={filtered} />}
      {view === "week" && (
        <WeekView
          reservations={filtered}
          locations={(data?.locations ?? []).filter((l) => l.reservationEnabled)}
        />
      )}
      {view === "map" && (
        <ReservationMap
          maps={maps}
          reservations={reservations}
          locationsById={locationsById}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- List

type ReservationRow = InstaQLEntity<
  AppSchema,
  "reservations",
  { contact: object; location: { type: object }; asset: object }
>;

function ListView({ reservations }: { reservations: ReservationRow[] }) {
  const current = useCurrent();
  if (reservations.length === 0) {
    return (
      <div className="placeholder">
        <div className="big">No reservations match</div>
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      {reservations.map((r) => {
        const target = reservationTargetOf(r);
        return (
          <Link
            key={r.id}
            to={`/reservations/${r.id}`}
            className="card spread"
            style={{ textDecoration: "none", color: "inherit", flexWrap: "wrap" }}
          >
            <div>
              <div className="card-title">
                {target ? `${target.name}` : "—"}
                <span className="muted small"> · {target?.typeLabel}</span>
              </div>
              <div className="card-meta">
                {r.contact?.name ?? "No contact"}
                {current.can("view_contact") && r.contact?.phone
                  ? ` · ${r.contact.phone}`
                  : ""}
                {target?.isPublic && r.rate != null && ` · $${r.rate}`}
                {target?.isPublic && r.balance != null && ` · balance $${r.balance}`}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className={reservationStatusBadgeClass(r.status)}>
                {statusLabel(r.status)}
              </span>
              <div className="muted small">{formatRange(r.expectedCheckin, r.expectedCheckout)}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function formatRange(
  start: string | number | null | undefined,
  end: string | number | null | undefined,
): string {
  const fmt = (v: string | number) =>
    new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `from ${fmt(start)}`;
  return "dates not set";
}

// ---------------------------------------------------------------- Calendar

// Month grid; each day lists reservations whose expected range covers it.
function CalendarView({ reservations }: { reservations: ReservationRow[] }) {
  const navigate = useNavigate();
  const [monthStart, setMonthStart] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const shiftMonth = (delta: number) =>
    setMonthStart(new Date(monthStart.getFullYear(), monthStart.getMonth() + delta, 1));

  const daysInMonth = new Date(
    monthStart.getFullYear(),
    monthStart.getMonth() + 1,
    0,
  ).getDate();
  const firstWeekday = monthStart.getDay();

  const coverage = (dayTs: number) =>
    reservations.filter((r) => {
      if (r.status === "cancelled" || !r.expectedCheckin) return false;
      const start = new Date(r.expectedCheckin).getTime();
      const end = r.expectedCheckout
        ? new Date(r.expectedCheckout).getTime()
        : start + 24 * 3600_000;
      return rangesOverlap(dayTs, dayTs + 24 * 3600_000, start, end);
    });

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button type="button" className="btn btn-sm" onClick={() => shiftMonth(-1)}>
          ←
        </button>
        <span className="section-title" style={{ marginBottom: 0 }}>
          {monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => shiftMonth(1)}>
          →
        </button>
      </div>
      <div className="cal-grid">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="cal-head">
            {d}
          </div>
        ))}
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <div key={`pad-${i}`} className="cal-cell cal-pad" />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dayTs = new Date(
            monthStart.getFullYear(),
            monthStart.getMonth(),
            day,
          ).getTime();
          const todays = coverage(dayTs);
          return (
            <div key={day} className="cal-cell">
              <div className="cal-day">{day}</div>
              {todays.slice(0, 3).map((r) => {
                const target = reservationTargetOf(r);
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={"cal-chip " + reservationStatusBadgeClass(r.status)}
                    title={`${target?.name} — ${r.contact?.name ?? ""}`}
                    onClick={() => navigate(`/reservations/${r.id}`)}
                  >
                    {target?.name}
                  </button>
                );
              })}
              {todays.length > 3 && (
                <span className="muted small">+{todays.length - 3} more</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Week

type WeekLocation = {
  id: string;
  name: string;
  status: string;
  postReservationStatus?: string | null;
};

// One row per reservable Location, one column per day, stays spanning the
// days they cover. Row tint: green when Available (Vacant) — deliberately
// outranking orange, so a pavilion whose post-reservation status is Vacant
// reads green — orange when sitting in its own post-reservation status
// (e.g. Needs Cleaning), red for every other status.
function rowTint(l: WeekLocation): string {
  if (l.status === "vacant" || l.status === "available") return "var(--good-bg)";
  const postStatus = l.postReservationStatus ?? DEFAULT_POST_RESERVATION_STATUS;
  if (l.status === postStatus) return "var(--warn-bg)";
  return "var(--bad-bg)";
}

function WeekView({
  reservations,
  locations,
}: {
  reservations: ReservationRow[];
  locations: WeekLocation[];
}) {
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d;
  });

  const shiftWeek = (delta: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + delta * 7);
    setWeekStart(d);
  };

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  const sorted = [...locations].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true }),
  );

  const staysFor = (locationId: string, dayTs: number) =>
    reservations.filter((r) => {
      if (r.location?.id !== locationId || r.status === "cancelled" || !r.expectedCheckin)
        return false;
      const start = new Date(r.expectedCheckin).getTime();
      const end = r.expectedCheckout
        ? new Date(r.expectedCheckout).getTime()
        : start + 24 * 3600_000;
      return rangesOverlap(dayTs, dayTs + 24 * 3600_000, start, end);
    });

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button type="button" className="btn btn-sm" onClick={() => shiftWeek(-1)}>
          ←
        </button>
        <span className="section-title" style={{ marginBottom: 0 }}>
          Week of{" "}
          {weekStart.toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </span>
        <button type="button" className="btn btn-sm" onClick={() => shiftWeek(1)}>
          →
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="placeholder">
          <div className="big">No reservation-enabled locations</div>
          Enable reservations per location from its detail page or Admin.
        </div>
      ) : (
        <div className="week-scroll">
          <table className="table week-table">
            <thead>
              <tr>
                <th>Location</th>
                {days.map((d) => (
                  <th key={d.getTime()}>
                    {d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((l) => (
                <tr key={l.id}>
                  <td style={{ background: rowTint(l) }}>
                    <Link to={`/locations/${l.id}`} style={{ fontWeight: 650 }}>
                      {l.name}
                    </Link>
                    <div className="muted small">{statusLabel(l.status)}</div>
                  </td>
                  {days.map((d) => {
                    const stays = staysFor(l.id, d.getTime());
                    return (
                      <td key={d.getTime()}>
                        {stays.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            className={"cal-chip " + reservationStatusBadgeClass(r.status)}
                            title={`${r.contact?.name ?? ""} — ${statusLabel(r.status)}`}
                            onClick={() => navigate(`/reservations/${r.id}`)}
                          >
                            {r.contact?.name ?? statusLabel(r.status)}
                          </button>
                        ))}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>
        Row tint — green: available now; orange: awaiting turnaround (sitting in its
        post-checkout status); red: any other status.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- Map

// Same plotted rectangles as the Locations schematic, colored by reservation
// state instead of occupancy. Asset-target reservations have no rectangle and
// appear only in list/calendar.
function ReservationMap({
  maps,
  reservations,
  locationsById,
}: {
  maps: Parameters<typeof SchematicMapView>[0]["maps"];
  reservations: ReservationRow[];
  locationsById: Map<string, { reservationEnabled: boolean }>;
}) {
  const navigate = useNavigate();
  const now = Date.now();

  const stateFor = (locationId: string): RectStyle => {
    const forLocation = reservations.filter(
      (r) => r.location?.id === locationId && r.status !== "cancelled",
    );
    if (forLocation.some((r) => r.status === "checked_in")) {
      return { background: "var(--bad-bg)", border: "var(--bad)" };
    }
    const upcoming = forLocation.some(
      (r) =>
        (r.status === "confirmed" || r.status === "requested") &&
        r.expectedCheckin &&
        new Date(r.expectedCheckin).getTime() > now - 24 * 3600_000,
    );
    if (upcoming) return { background: "var(--warn-bg)", border: "var(--warn)" };
    return { background: "var(--good-bg)", border: "var(--good)" };
  };

  const openLocation = (locationId: string) => {
    // Tapping a rectangle opens its soonest active/upcoming reservation, or
    // the location itself when nothing is booked.
    const forLocation = reservations
      .filter((r) => r.location?.id === locationId && r.status !== "cancelled")
      .sort((a, b) => {
        const at = a.expectedCheckin ? new Date(a.expectedCheckin).getTime() : Infinity;
        const bt = b.expectedCheckin ? new Date(b.expectedCheckin).getTime() : Infinity;
        return at - bt;
      });
    const active =
      forLocation.find((r) => r.status === "checked_in") ??
      forLocation.find(
        (r) => r.expectedCheckout && new Date(r.expectedCheckout).getTime() > now,
      );
    navigate(active ? `/reservations/${active.id}` : `/locations/${locationId}`);
  };

  return (
    <SchematicMapView
      maps={maps}
      colorFor={stateFor}
      include={(locationId) => locationsById.get(locationId)?.reservationEnabled ?? false}
      onOpen={openLocation}
      footnote="Green: available. Amber: upcoming reservation. Red: checked in now. Only reservation-enabled locations are shown; asset reservations appear in list/calendar only."
    />
  );
}
