import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { compareNames, statusKey, statusLabel } from "../../lib/locations";
import {
  RESERVATION_STATUSES,
  isBillable,
  rangesOverlap,
  reservationStatusBadgeClass,
  reservationTargetOf,
} from "../../lib/reservations";
import { SchematicMapView, type RectStyle } from "../shared/SchematicMapView";
import { useReservations, type ReservationRow } from "../../data/reservations";
import { useLocations, type LocationRow } from "../../data/locations";
import { DEFAULT_POST_RESERVATION_STATUS } from "../../data/lookups";

// Reservations — Calendar / List (see docs/pages/reservation-list.html).
// One screen for every reservable target, Location or Asset alike. Browsing
// is unrestricted; only creating/editing needs manage_reservations.
type ViewMode = "list" | "calendar" | "week" | "map";

export function ReservationListPage() {
  const current = useCurrent();
  const [view, setView] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Already ordered by expected check-in; the map and week views need every
  // location, not only the filtered set, so they read it separately.
  const { data: reservations } = useReservations();
  const { data: locations } = useLocations();

  const filtered = reservations.filter((r) => {
    const target = reservationTargetOf(r);
    if (statusFilter && r.status !== statusFilter) return false;
    if (kindFilter && target?.kind !== kindFilter) return false;
    const start = r.expected_checkin ? new Date(r.expected_checkin).getTime() : null;
    const end = r.expected_checkout ? new Date(r.expected_checkout).getTime() : start;
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
          locations={locations.filter((l) => l.reservation_enabled === 1)}
        />
      )}
      {view === "map" && (
        <ReservationMap reservations={reservations} locations={locations} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- List

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
                {r.contact_name ?? "No contact"}
                {current.can("view_contact") && r.contact_phone
                  ? ` · ${r.contact_phone}`
                  : ""}
                {isBillable(r, target) && r.rate != null && ` · $${r.rate}`}
                {isBillable(r, target) && r.balance != null && ` · balance $${r.balance}`}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <span className={reservationStatusBadgeClass(r.status)}>
                {statusLabel(r.status)}
              </span>
              <div className="muted small">
                {formatRange(r.expected_checkin, r.expected_checkout)}
              </div>
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
      if (r.status === "cancelled" || !r.expected_checkin) return false;
      const start = new Date(r.expected_checkin).getTime();
      const end = r.expected_checkout
        ? new Date(r.expected_checkout).getTime()
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
                    title={`${target?.name} — ${r.contact_name ?? ""}`}
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

// One row per reservable location, one column per day, stays spanning the days
// they cover. Row tint: green when available (Vacant) — deliberately
// outranking orange, so a pavilion whose post-reservation status is Vacant
// reads green — orange when sitting in its own post-reservation status (e.g.
// Needs Cleaning), red for every other status.
//
// Compared on the normalised status NAME rather than the id, because the
// post-reservation default is a name in code and a marina may not have created
// a status by that name at all.
function rowTint(l: LocationRow, postStatusName: string | null): string {
  const key = statusKey(l.status_name);
  if (key === "vacant" || key === "available") return "var(--good-bg)";
  const post = statusKey(postStatusName ?? DEFAULT_POST_RESERVATION_STATUS);
  if (key && key === post) return "var(--warn-bg)";
  return "var(--bad-bg)";
}

function WeekView({
  reservations,
  locations,
}: {
  reservations: ReservationRow[];
  locations: LocationRow[];
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

  const sorted = [...locations].sort((a, b) => compareNames(a.name, b.name));

  const staysFor = (locationId: string, dayTs: number) =>
    reservations.filter((r) => {
      if (
        r.location_id !== locationId ||
        r.status === "cancelled" ||
        !r.expected_checkin
      )
        return false;
      const start = new Date(r.expected_checkin).getTime();
      const end = r.expected_checkout
        ? new Date(r.expected_checkout).getTime()
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
                  <td style={{ background: rowTint(l, null) }}>
                    <Link to={`/locations/${l.id}`} style={{ fontWeight: 650 }}>
                      {l.name}
                    </Link>
                    <div className="muted small">{l.status_name ?? "—"}</div>
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
                            title={`${r.contact_name ?? ""} — ${statusLabel(r.status)}`}
                            onClick={() => navigate(`/reservations/${r.id}`)}
                          >
                            {r.contact_name ?? statusLabel(r.status)}
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
  reservations,
  locations,
}: {
  reservations: ReservationRow[];
  locations: LocationRow[];
}) {
  const navigate = useNavigate();
  const now = Date.now();
  const reservable = useMemo(
    () => new Set(locations.filter((l) => l.reservation_enabled === 1).map((l) => l.id)),
    [locations],
  );

  const stateFor = (locationId: string): RectStyle => {
    const forLocation = reservations.filter(
      (r) => r.location_id === locationId && r.status !== "cancelled",
    );
    if (forLocation.some((r) => r.status === "checked_in")) {
      return { background: "var(--bad-bg)", border: "var(--bad)", text: "var(--bad)" };
    }
    const upcoming = forLocation.some(
      (r) =>
        (r.status === "confirmed" || r.status === "requested") &&
        r.expected_checkin &&
        new Date(r.expected_checkin).getTime() > now - 24 * 3600_000,
    );
    if (upcoming)
      return { background: "var(--warn-bg)", border: "var(--warn)", text: "var(--warn)" };
    return { background: "var(--good-bg)", border: "var(--good)", text: "var(--good)" };
  };

  const openLocation = (locationId: string) => {
    // Tapping a rectangle opens its soonest active/upcoming reservation, or
    // the location itself when nothing is booked.
    const forLocation = reservations
      .filter((r) => r.location_id === locationId && r.status !== "cancelled")
      .sort((a, b) => {
        const at = a.expected_checkin ? new Date(a.expected_checkin).getTime() : Infinity;
        const bt = b.expected_checkin ? new Date(b.expected_checkin).getTime() : Infinity;
        return at - bt;
      });
    const active =
      forLocation.find((r) => r.status === "checked_in") ??
      forLocation.find(
        (r) => r.expected_checkout && new Date(r.expected_checkout).getTime() > now,
      );
    navigate(active ? `/reservations/${active.id}` : `/locations/${locationId}`);
  };

  return (
    <SchematicMapView
      colorFor={stateFor}
      include={(locationId) => reservable.has(locationId)}
      onOpen={openLocation}
      footnote="Green: available. Amber: upcoming reservation. Red: checked in now. Only reservation-enabled locations are shown; asset reservations appear in list/calendar only."
    />
  );
}
