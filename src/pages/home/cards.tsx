import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ComponentType } from "react";
import { id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import type { CurrentUser } from "../../lib/auth/useCurrentUser";
import {
  createInstanceFromTemplate,
  hasWorkAtCreation,
  useInstantiableTemplates,
} from "../../data/checklists";
import { useRoleIdsFor } from "../../data/users";
import {
  attachEndOfShiftChecklist,
  endShift,
  startShift,
  useActiveShift,
} from "../../data/shifts";
import { useTickets } from "../../data/tickets";
import { useIncidents } from "../../data/incidents";
import { useMissedCalls, useSmsThreads } from "../../data/comms";
import { useReservations } from "../../data/reservations";

// Dashboard cards (see pages/dashboard.html — Available cards).
// A card's availability gate is exactly the permission that governs the data
// it reads — no card-specific permissions exist.

export type CardId =
  | "clock"
  | "shift"
  | "ticket_summary"
  | "incident_summary"
  | "missed_comms"
  | "upcoming_reservations"
  | "admin_shortcuts";

export interface CardDef {
  id: CardId;
  title: string;
  available: (current: CurrentUser) => boolean;
  /** Role names (predefined set) whose default layout includes this card. */
  defaultForRoles: string[] | "all";
  Component: ComponentType;
}

const ALL_MANAGER_ROLES = ["Marina Manager", "Owner"];

export const CARD_REGISTRY: CardDef[] = [
  {
    id: "clock",
    title: "Clock",
    available: () => true,
    defaultForRoles: "all",
    Component: ClockCard,
  },
  {
    id: "shift",
    title: "Shift",
    available: () => true,
    defaultForRoles: ["Security"],
    Component: ShiftCard,
  },
  {
    id: "ticket_summary",
    title: "Ticket summary",
    available: () => true,
    defaultForRoles: ["Maintenance", "Office"],
    Component: TicketSummaryCard,
  },
  {
    id: "incident_summary",
    title: "Incident summary",
    available: (c) => c.can("view_incidents"),
    defaultForRoles: ["Security", ...ALL_MANAGER_ROLES],
    Component: IncidentSummaryCard,
  },
  {
    id: "missed_comms",
    title: "Missed comms",
    available: (c) => c.can("view_calls") || c.can("view_sms"),
    defaultForRoles: ["Office"],
    Component: MissedCommsCard,
  },
  {
    id: "upcoming_reservations",
    title: "Upcoming reservations",
    available: () => true,
    defaultForRoles: ["Office", ...ALL_MANAGER_ROLES],
    Component: UpcomingReservationsCard,
  },
  {
    id: "admin_shortcuts",
    title: "Admin shortcuts",
    available: (c) => c.isAdmin,
    defaultForRoles: ALL_MANAGER_ROLES,
    Component: AdminShortcutsCard,
  },
];

export type LayoutEntry = { card: string; visible: boolean };

// Role-derived default layout for a user who has never customized theirs.
export function defaultLayout(roleNames: string[]): LayoutEntry[] {
  return CARD_REGISTRY.filter(
    (def) =>
      def.defaultForRoles === "all" ||
      def.defaultForRoles.some((r) => roleNames.includes(r)),
  ).map((def) => ({ card: def.id, visible: true }));
}

// ---------------------------------------------------------------- Clock

function ClockCard() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div>
      <div className="dash-clock">
        {now.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        })}
      </div>
      <div className="card-meta">
        {now.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Shift

function ShiftCard() {
  const current = useCurrent();
  const navigate = useNavigate();
  const userId = current.user?.id;

  const { shift: activeShift } = useActiveShift(userId);
  const roleIds = useRoleIdsFor(userId);
  const clockTemplates = useInstantiableTemplates(["clock_in", "clock_out"]);

  // Clock templates are role-scoped like everything else — a maintenance
  // clock-in checklist shouldn't fire for a security guard.
  const mine = clockTemplates.filter(
    (t) => t.assigned_role_id && roleIds.includes(t.assigned_role_id),
  );
  // A template with nothing switched on right now generates nothing — see
  // hasWorkAtCreation. Empty checklists are noise, and with status-gated
  // sections an empty one is an ordinary outcome, not a mistake.
  const clockInTemplate = mine.find(
    (t) => t.trigger_type === "clock_in" && hasWorkAtCreation(t),
  );
  const clockOutTemplate = mine.find(
    (t) => t.trigger_type === "clock_out" && hasWorkAtCreation(t),
  );

  // Re-render each minute so elapsed time stays fresh.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const begin = async () => {
    if (!userId || !current.user) return;
    await startShift({ id: userId, name: current.user.name });
    // Clock In may itself be a checklist trigger — the checklist opens
    // immediately, in its own transaction so a failure to build it cannot
    // roll back the fact that the shift started.
    if (clockInTemplate) {
      const checklistId = await createInstanceFromTemplate({
        template: clockInTemplate,
        userId,
        reason: "clock-in",
      });
      navigate(`/checklists/${checklistId}`);
    }
  };

  const endShiftManually = async () => {
    if (!activeShift || !userId || !current.user) return;
    await endShift(activeShift.id, { id: userId, name: current.user.name });
    // TODO: call the shift-report Netlify Function on-demand once the
    // functions layer exists; the scheduled backstop sweep covers it meanwhile.
  };

  const startEndOfShiftChecklist = async () => {
    if (!activeShift || !clockOutTemplate || !userId) return;
    const checklistId = id();
    await createInstanceFromTemplate({
      template: clockOutTemplate,
      userId,
      instanceId: checklistId,
      reason: "clock-out",
    });
    await attachEndOfShiftChecklist(activeShift.id, checklistId);
    navigate(`/checklists/${checklistId}`);
  };

  if (!activeShift) {
    return (
      <div>
        <div className="card-title">No active shift</div>
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void begin()}
          >
            Start Shift
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card-title">
        On shift · {formatElapsed(activeShift.started_at)}
      </div>
      <div className="card-meta">
        Started{" "}
        {new Date(activeShift.started_at).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })}
      </div>
      <div style={{ marginTop: 10 }}>
        {clockOutTemplate ? (
          <button
            type="button"
            className="btn"
            onClick={() => void startEndOfShiftChecklist()}
          >
            Complete end-of-shift checklist
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void endShiftManually()}
          >
            End Shift
          </button>
        )}
      </div>
    </div>
  );
}

function formatElapsed(startedAt: string | number): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ---------------------------------------------------------------- Tickets

function TicketSummaryCard() {
  // "Open" is any status the marina has not flagged terminal, so a marina that
  // adds "Waiting on parts" gets it counted without a code change.
  const { data: tickets } = useTickets();
  const open = tickets.filter((t) => t.status_is_terminal === 0);
  const urgent = open.filter((t) => t.priority === "urgent").length;
  const high = open.filter((t) => t.priority === "high").length;
  return (
    <Link to="/tickets" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="dash-count">{open.length} open</div>
      <div className="card-meta">
        {urgent > 0 && <span className="badge badge-bad">{urgent} urgent </span>}{" "}
        {high > 0 && <span className="badge badge-warn">{high} high</span>}
        {urgent === 0 && high === 0 && "No urgent or high-priority tickets"}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------- Incidents

function IncidentSummaryCard() {
  const { data: incidents } = useIncidents();
  const open = incidents.filter((i) => i.status_is_terminal === 0);
  const underReview = open.filter(
    (i) => i.status_name.toLowerCase() === "under review",
  ).length;
  return (
    <Link to="/incidents" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="dash-count">{open.length} open</div>
      <div className="card-meta">
        {underReview > 0
          ? `${underReview} under review`
          : "Recent and open incidents"}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------- Missed comms

function MissedCommsCard() {
  const current = useCurrent();
  const canCalls = current.can("view_calls");
  const canSms = current.can("view_sms");
  // The card sums only what this user can see. It does not have to filter for
  // that — the rows were never synced to a device without the permission — but
  // it does have to avoid rendering "0 missed calls" to someone who has no
  // business having an opinion about calls at all.
  const { data: calls } = useMissedCalls();
  const { data: threads } = useSmsThreads();
  const missedCalls = canCalls ? calls.length : 0;
  const unreadSms = canSms ? threads.filter((t) => t.unread === 1).length : 0;
  const parts = [
    ...(canCalls ? [`${missedCalls} missed call${missedCalls === 1 ? "" : "s"}`] : []),
    ...(canSms ? [`${unreadSms} unread text${unreadSms === 1 ? "" : "s"}`] : []),
  ];
  return (
    <Link to="/comms" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card-title">{parts.join(" · ")}</div>
      <div className="card-meta">Tap to review missed calls and texts</div>
    </Link>
  );
}

// ---------------------------------------------------------------- Reservations

function UpcomingReservationsCard() {
  const { data: reservations } = useReservations();
  const soon = reservations
    .filter(
      (r) =>
        (r.status === "requested" || r.status === "confirmed") &&
        r.expected_checkin != null,
    )
    .map((r) => ({ r, checkin: new Date(r.expected_checkin!).getTime() }))
    .filter(({ checkin }) => checkin > Date.now() - 24 * 3600_000)
    .sort((a, b) => a.checkin - b.checkin)
    .slice(0, 4);

  return (
    <Link
      to="/reservations"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      {soon.length === 0 ? (
        <div className="card-title muted">No upcoming reservations</div>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {soon.map(({ r, checkin }) => (
            <div key={r.id} className="spread">
              <span style={{ fontWeight: 650 }}>
                {r.location_name ?? r.asset_name ?? "—"}
              </span>
              <span className="muted small">
                {formatCheckin(checkin)}
                {r.contact_name ? ` · ${r.contact_name}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}

function formatCheckin(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 3600_000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "today";
  if (sameDay(date, tomorrow)) return "tomorrow";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------- Admin

const ADMIN_SHORTCUTS: { label: string; to: string; requires: string }[] = [
  { label: "Users", to: "/admin/users", requires: "manage_users" },
  { label: "Roles & Permissions", to: "/admin/roles", requires: "manage_roles" },
  { label: "Checklist Templates", to: "/admin/checklist-templates", requires: "manage_checklists" },
  { label: "Locations", to: "/admin/locations", requires: "manage_locations" },
  { label: "Assets", to: "/admin/assets", requires: "manage_assets" },
  { label: "Marina Settings", to: "/admin/settings", requires: "manage_marina_settings" },
];

function AdminShortcutsCard() {
  const current = useCurrent();
  const links = ADMIN_SHORTCUTS.filter((s) =>
    current.permissions.has(s.requires as never),
  );
  return (
    <div className="row" style={{ flexWrap: "wrap" }}>
      {links.map((s) => (
        <Link key={s.to} to={s.to} className="btn btn-sm">
          {s.label}
        </Link>
      ))}
    </div>
  );
}
