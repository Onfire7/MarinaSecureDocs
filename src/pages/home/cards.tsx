import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import type { ComponentType } from "react";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import type { CurrentUser } from "../../lib/auth/useCurrentUser";
import {
  createInstanceFromTemplate,
  hasWorkAtCreation,
  useInstantiableTemplates,
} from "../../data/checklists";
import { useRoleIdsFor } from "../../data/users";
import { clockInTemplates } from "../../lib/checklistStart";
import { startShift } from "../../data/shifts";
import { useEndOfShift } from "../../data/endOfShift";
import { useEndOfShiftLabel, useGoToEndOfShiftStep } from "./useEndOfShiftStep";
import { useTickets } from "../../data/tickets";
import { useIncidents } from "../../data/incidents";
import { useMissedCalls, useSmsThreads } from "../../data/comms";
import { useReservations } from "../../data/reservations";
import { FleetCard } from "./FleetCard";
import type { TFunction } from "i18next";
import { date, duration, time } from "../../i18n";

// Dashboard cards (see DashboardPage.spec.md § Cards).
// A card's availability gate is exactly the permission that governs the data
// it reads — no card-specific permissions exist.

export type CardId =
  | "clock"
  | "shift"
  | "ticket_summary"
  | "incident_summary"
  | "missed_comms"
  | "upcoming_reservations"
  | "admin_shortcuts"
  | "fleet";

/** What a card's availability may depend on besides the user's permissions,
 *  read once by the Dashboard. */
export interface CardContext {
  /** The Fleet card hides while the marina has no Fleet Vehicles. */
  fleetVehicles: number;
}

// A card's title is home:card.<id>.
export interface CardDef {
  id: CardId;
  available: (current: CurrentUser, context: CardContext) => boolean;
  /** Role names (predefined set) whose default layout includes this card. */
  defaultForRoles: string[] | "all";
  Component: ComponentType;
}

const ALL_MANAGER_ROLES = ["Marina Manager", "Owner"];

export const CARD_REGISTRY: CardDef[] = [
  {
    id: "clock",
    available: () => true,
    defaultForRoles: "all",
    Component: ClockCard,
  },
  {
    id: "shift",
    available: () => true,
    defaultForRoles: ["Security"],
    Component: ShiftCard,
  },
  {
    id: "ticket_summary",
    available: () => true,
    defaultForRoles: ["Maintenance", "Office"],
    Component: TicketSummaryCard,
  },
  {
    id: "incident_summary",
    available: (c) => c.can("view_incidents"),
    defaultForRoles: ["Security", ...ALL_MANAGER_ROLES],
    Component: IncidentSummaryCard,
  },
  {
    id: "missed_comms",
    available: (c) => c.can("view_calls") || c.can("view_sms"),
    defaultForRoles: ["Office"],
    Component: MissedCommsCard,
  },
  {
    id: "upcoming_reservations",
    available: () => true,
    defaultForRoles: ["Office", ...ALL_MANAGER_ROLES],
    Component: UpcomingReservationsCard,
  },
  {
    id: "admin_shortcuts",
    available: (c) => c.isAdmin,
    defaultForRoles: ALL_MANAGER_ROLES,
    Component: AdminShortcutsCard,
  },
  {
    id: "fleet",
    available: (c, ctx) => c.can("use_fleet") && ctx.fleetVehicles > 0,
    defaultForRoles: ["Security"],
    Component: FleetCard,
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
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);
  return (
    <div>
      <div className="dash-clock">
        {time(now, {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
        })}
      </div>
      <div className="card-meta">
        {date(now, {
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
  const { t } = useTranslation("home");
  const current = useCurrent();
  const navigate = useNavigate();
  const userId = current.user?.id;

  const roleIds = useRoleIdsFor(userId);
  const clockIn = useInstantiableTemplates(["clock_in"]);
  // The end of the shift is one button whose label is its next step
  // (DashboardPage.spec.md § The Shift card). Nothing on this card ends the
  // shift: only End Shift and Submit, on the review, does.
  const endOfShift = useEndOfShift(userId);
  const goToNextStep = useGoToEndOfShiftStep();
  const nextStepLabel = useEndOfShiftLabel(endOfShift.step);
  const activeShift = endOfShift.shift;

  // Clock templates are role-scoped like everything else — a maintenance
  // clock-in checklist shouldn't fire for a security guard. A template with
  // nothing switched on right now generates nothing — see hasWorkAtCreation.
  // Empty checklists are noise, and with status-gated sections an empty one is
  // an ordinary outcome, not a mistake. Every matching template, not the
  // first: a role may hold several (DashboardPage.spec.md § The Shift card).
  const clockInTemplatesDue = clockInTemplates(clockIn, roleIds, (t) =>
    hasWorkAtCreation(t),
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
    // Clock In may itself be a checklist trigger — each checklist is built in
    // its own transaction so a failure to build one cannot roll back the fact
    // that the shift started, or the others. One opens immediately; several
    // land on the Checklists page, where they are the open work.
    const created: string[] = [];
    for (const template of clockInTemplatesDue) {
      created.push(
        await createInstanceFromTemplate({ template, userId, reason: { kind: "clockIn" } }),
      );
    }
    if (created.length === 1) navigate(`/checklists/${created[0]}`);
    else if (created.length > 1) navigate("/checklists");
  };

  if (!activeShift) {
    return (
      <div>
        <div className="card-title">{t("shift.none")}</div>
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void begin()}
          >
            {t("shift.start")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="card-title">
        {t("shift.onShift", { elapsed: duration(Date.now() - new Date(activeShift.started_at).getTime()) })}
      </div>
      <div className="card-meta">
        {t("shift.started", {
          time: time(activeShift.started_at, { hour: "numeric", minute: "2-digit" }),
        })}
      </div>
      {endOfShift.step && (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn"
            data-testid="shift-card-next"
            onClick={() => void goToNextStep(endOfShift)}
          >
            {nextStepLabel}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Tickets

function TicketSummaryCard() {
  const { t } = useTranslation("home");
  // "Open" is any status the marina has not flagged terminal, so a marina that
  // adds "Waiting on parts" gets it counted without a code change.
  const { data: tickets } = useTickets();
  const open = tickets.filter((t) => t.status_is_terminal === 0);
  const urgent = open.filter((t) => t.priority === "urgent").length;
  const high = open.filter((t) => t.priority === "high").length;
  return (
    <Link to="/tickets" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="dash-count">{t("tickets.open", { count: open.length })}</div>
      <div className="card-meta">
        {urgent > 0 && <span className="badge badge-bad">{t("tickets.urgent", { count: urgent })} </span>}{" "}
        {high > 0 && <span className="badge badge-warn">{t("tickets.high", { count: high })}</span>}
        {urgent === 0 && high === 0 && t("tickets.calm")}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------- Incidents

function IncidentSummaryCard() {
  const { t } = useTranslation("home");
  const { data: incidents } = useIncidents();
  const open = incidents.filter((i) => i.status_is_terminal === 0);
  const underReview = open.filter(
    (i) => i.status_name.toLowerCase() === "under review",
  ).length;
  return (
    <Link to="/incidents" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="dash-count">{t("incidents.open", { count: open.length })}</div>
      <div className="card-meta">
        {underReview > 0
          ? t("incidents.underReview", { count: underReview })
          : t("incidents.hint")}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------- Missed comms

function MissedCommsCard() {
  const { t } = useTranslation("home");
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
    ...(canCalls ? [t("comms.missedCalls", { count: missedCalls })] : []),
    ...(canSms ? [t("comms.unreadTexts", { count: unreadSms })] : []),
  ];
  return (
    <Link to="/comms" style={{ textDecoration: "none", color: "inherit" }}>
      <div className="card-title">{parts.join(" · ")}</div>
      <div className="card-meta">{t("comms.hint")}</div>
    </Link>
  );
}

// ---------------------------------------------------------------- Reservations

function UpcomingReservationsCard() {
  const { t } = useTranslation("home");
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
        <div className="card-title muted">{t("reservations.none")}</div>
      ) : (
        <div className="stack" style={{ gap: 6 }}>
          {soon.map(({ r, checkin }) => (
            <div key={r.id} className="spread">
              <span style={{ fontWeight: 650 }}>
                {r.location_name ?? r.asset_name ?? "—"}
              </span>
              <span className="muted small">
                {formatCheckin(checkin, t)}
                {r.contact_name ? ` · ${r.contact_name}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}

function formatCheckin(ts: number, t: TFunction<"home">): string {
  const when = new Date(ts);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 3600_000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(when, today)) return t("reservations.today");
  if (sameDay(when, tomorrow)) return t("reservations.tomorrow");
  return date(when, { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------- Admin

// `label` is the key into home:shortcut.
const ADMIN_SHORTCUTS: { label: "users" | "roles" | "checklistTemplates" | "locations" | "assets" | "settings"; to: string; requires: string }[] = [
  { label: "users", to: "/admin/users", requires: "manage_users" },
  { label: "roles", to: "/admin/roles", requires: "manage_roles" },
  { label: "checklistTemplates", to: "/admin/checklist-templates", requires: "manage_checklists" },
  { label: "locations", to: "/admin/locations", requires: "manage_locations" },
  { label: "assets", to: "/admin/assets", requires: "manage_assets" },
  { label: "settings", to: "/admin/settings", requires: "manage_marina_settings" },
];

function AdminShortcutsCard() {
  const { t } = useTranslation("home");
  const current = useCurrent();
  const links = ADMIN_SHORTCUTS.filter((s) =>
    current.permissions.has(s.requires as never),
  );
  return (
    <div className="row" style={{ flexWrap: "wrap" }}>
      {links.map((s) => (
        <Link key={s.to} to={s.to} className="btn btn-sm">
          {t(`shortcut.${s.label}`)}
        </Link>
      ))}
    </div>
  );
}
