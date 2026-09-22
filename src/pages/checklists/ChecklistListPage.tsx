import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { eligibleToday, isVisibleNow, triggerTypeLabel } from "../../lib/checklists";
import {
  createInstanceFromTemplate,
  hasWorkAtCreation,
  recurringInstanceId,
  useExistingInstanceIds,
  useInstantiableTemplates,
  useMonitoredChecklists,
  useMyChecklists,
} from "../../data/checklists";
import { useRoleIdsFor } from "../../data/users";
import { useTours, useTourCheckpoints } from "../../data/checkpoints";
import { ManualCheckinDialog } from "./ManualCheckinDialog";
import { TourSection } from "./TourSection";
import { useShiftVisits } from "./useShiftVisits";

// Checklists & Tours — Checklist List (see pages/checklist-list.html).
//
// A guard's work queue, not an audit table. Open work — in-progress and
// not-started checklists, then each tour's remaining checkpoints — sits
// front and center as tappable cards; finished work drops into collapsed
// sections. Tours render inline under a small heading per tour rather than
// behind a tab and a second page: a guard typically has exactly one active
// tour, and the old arrangement made its steps two navigations away from
// the page they start every round on. History lives in Reports and each
// checklist's own detail page, so this screen only owes a glance backwards.
//
// This page is also where recurring templates become real checklists: there
// is no server-side scheduler, so the first role-holder to open the app on a
// matching day creates that day's instance (deterministic id — clients
// racing converge on the same row). Templates the user's roles only *view*
// (viewerRoles) appear in a read-only Monitoring section.
//
// Desktop puts checklists and tours in adjacent columns; without tour
// access there is no second column, so the freed width goes to information
// density instead — open-checklist cards flow two per row. Mobile is one
// column either way.
export function ChecklistListPage() {
  const current = useCurrent();
  const navigate = useNavigate();
  const userId = current.user?.id;
  const isSecurity = current.roleNames.includes("Security");
  const [showManualCheckin, setShowManualCheckin] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [nothingToStart, setNothingToStart] = useState<string | null>(null);
  const [manualTemplateId, setManualTemplateId] = useState("");

  const roleIds = useRoleIdsFor(userId);

  // Manual templates feed the Start button; recurring ones feed the
  // auto-create effect below. Both need the full instantiation shape.
  const templates = useInstantiableTemplates(["manual", "recurring"]);
  const myTemplates = templates.filter(
    (t) => t.assigned_role_id && roleIds.includes(t.assigned_role_id),
  );
  const manualTemplates = myTemplates.filter((t) => t.trigger_type === "manual");

  const startChecklist = async (template: (typeof manualTemplates)[number]) => {
    if (!userId || starting) return;
    // Silently doing nothing after someone taps Start is worse than the
    // empty checklist would have been.
    if (!hasWorkAtCreation(template)) {
      setNothingToStart(template.name);
      return;
    }
    setNothingToStart(null);
    setStarting(template.id);
    const instanceId = await createInstanceFromTemplate({
      template,
      userId,
      reason: `${current.user?.name ?? "a user"} starting it manually`,
    });
    setStarting(null);
    navigate(`/checklists/${instanceId}`);
  };

  // ---- Recurring auto-create ----
  // One instance per template per local day, id derived from both so any
  // number of role-holders opening the page create it exactly once. Pinned
  // to the day this page mounted — a client left open across midnight picks
  // the new day up on its next visit here, which is fine: creation is
  // usage-driven by design.
  const [today] = useState(() => new Date());
  const dueToday = myTemplates.filter(
    (t) => t.trigger_type === "recurring" && eligibleToday(t, today) && hasWorkAtCreation(t, today),
  );
  const existingRecurring = useExistingInstanceIds(
    dueToday.map((t) => recurringInstanceId(t.id, today)),
  );
  const creatingRecurring = useRef(false);
  useEffect(() => {
    if (!userId || creatingRecurring.current) return;
    const missing = dueToday.filter(
      (t) => !existingRecurring.has(recurringInstanceId(t.id, today)),
    );
    if (missing.length === 0) return;
    creatingRecurring.current = true;
    void Promise.all(
      missing.map((t) =>
        createInstanceFromTemplate({
          template: t,
          userId,
          instanceId: recurringInstanceId(t.id, today),
          reason: "its recurring schedule",
          now: today,
        }),
      ),
    ).catch(console.error);
  }, [userId, dueToday, existingRecurring, today]);

  const { data: mine } = useMyChecklists(userId, roleIds);
  const { data: monitored } = useMonitoredChecklists(roleIds);

  const checklists = mine;

  // Read-only monitoring: instances of templates whose viewer roles include one
  // of mine but whose assigned role doesn't — e.g. the office watching
  // maintenance work through. Client-side only until the perms overhaul.
  const monitoring = useMemo(() => {
    const actionable = new Set(checklists.map((c) => c.id));
    return monitored.filter(
      (c) =>
        !actionable.has(c.id) &&
        !(c.assigned_role_id && roleIds.includes(c.assigned_role_id)) &&
        isVisibleNow(c),
    );
  }, [monitored, checklists, roleIds]);

  // The template's trigger is joined onto the instance for this label alone;
  // nothing on an instance records how it came to exist.
  const triggerLabel = (c: (typeof checklists)[number]) =>
    triggerTypeLabel(templates.find((t) => t.id === c.template_id)?.trigger_type);

  // In-progress outranks not-started: half-done work goes stale in a way
  // unstarted work doesn't. Instances still inside their hideUntil are
  // filtered out entirely — they exist, but aren't anyone's work yet.
  const open = checklists
    .filter((c) => c.status === "in_progress" || c.status === "not_started")
    .filter((c) => isVisibleNow(c))
    .sort((a, b) => {
      const rank = (s: string) => (s === "in_progress" ? 0 : 1);
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      return (b.started_at ?? "") > (a.started_at ?? "") ? 1 : -1;
    });

  // Backgrounded, not hidden — enough to confirm "yes, that one went
  // through" without scrolling this shift's completions above open work.
  // Older history belongs to Reports and the checklist's own detail page.
  const RECENT_COMPLETED = 15;
  const completed = checklists
    .filter((c) => c.status === "complete")
    .sort((a, b) => ((b.completed_at ?? "") > (a.completed_at ?? "") ? 1 : -1))
    .slice(0, RECENT_COMPLETED);

  const when = (ts: string | number | null | undefined) =>
    ts
      ? new Date(ts).toLocaleString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          month: "short",
          day: "numeric",
        })
      : null;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Checklists</h1>
        <div className="row">
          {manualTemplates.length > 0 && (
            <>
              <select
                className="select"
                value={manualTemplateId}
                onChange={(e) => setManualTemplateId(e.target.value)}
              >
                <option value="">Start a checklist…</option>
                {manualTemplates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!manualTemplateId || starting !== null}
                onClick={() => {
                  const template = manualTemplates.find((t) => t.id === manualTemplateId);
                  if (template) void startChecklist(template);
                }}
              >
                Start checklist
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setShowManualCheckin(true)}
          >
            Check in manually
          </button>
        </div>
      </div>

      {nothingToStart && (
        <div className="badge badge-warn" style={{ display: "block", marginBottom: 10 }}>
          Nothing to do in "{nothingToStart}" right now — none of its sections
          are switched on. A section gated on a location's status only runs
          when that location is in one of the statuses it names.
        </div>
      )}

      <div className={isSecurity ? "grid-2" : undefined}>
        <div>
            <div className={isSecurity ? "stack" : "two-col-cards"}>
              {open.map((c) => (
                <Link
                  key={c.id}
                  to={`/checklists/${c.id}`}
                  className="card spread"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span className="card-title">
                      {c.template_name ?? "Checklist"}
                    </span>
                    <span className="card-meta" style={{ display: "block" }}>
                      {triggerLabel(c)}
                      {c.started_at && ` · started ${when(c.started_at)}`}
                      {c.due_by && ` · due ${when(c.due_by)}`}
                    </span>
                  </span>
                  <span
                    className={
                      "badge" + (c.status === "in_progress" ? " badge-warn" : "")
                    }
                  >
                    {c.status === "in_progress" ? "Continue" : "Start"}
                  </span>
                </Link>
              ))}
            </div>

            {open.length === 0 && (
              <p className="muted small" style={{ marginTop: 4 }}>
                {checklists.length === 0
                  ? roleIds.length === 0
                    ? "No open checklists — you hold no roles with checklist assignments."
                    : "No open checklists — one appears when a checkpoint visit, schedule, or clock event triggers it."
                  : "No open checklists — everything assigned to you is complete."}
              </p>
            )}

            {monitoring.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="section-title">Monitoring</div>
                <div className="stack" style={{ gap: 4 }}>
                  {monitoring.map((c) => (
                    <Link
                      key={c.id}
                      to={`/checklists/${c.id}`}
                      className="spread muted"
                      style={{ textDecoration: "none", padding: "4px 0" }}
                    >
                      <span className="small" style={{ minWidth: 0 }}>
                        {c.template_name ?? "Checklist"}
                        <span className="muted">
                          {" · "}
                          {c.assignee_name ??
                            "unclaimed"}
                        </span>
                      </span>
                      <span
                        className={
                          "badge" + (c.status === "in_progress" ? " badge-warn" : "")
                        }
                      >
                        {c.status === "in_progress" ? "In progress" : "Not started"}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

        </div>

        {isSecurity && (
          <div>
            <ToursInline />
          </div>
        )}
      </div>

      {/* Below everything, behind a rule: finished work is worth confirming
          at a glance and worth nothing above the work still to do. */}
      {completed.length > 0 && (
        <div className="completed-divider">
          <div className="section-title">
            Completed · {completed.length}
            {checklists.filter((c) => c.status === "complete").length >
              RECENT_COMPLETED && " most recent"}
          </div>
          <div className="stack" style={{ gap: 4 }}>
            {completed.map((c) => (
              <Link
                key={c.id}
                to={`/checklists/${c.id}`}
                className="spread muted"
                style={{ textDecoration: "none", padding: "4px 0" }}
              >
                <span className="small" style={{ minWidth: 0 }}>
                  {c.template_name ?? "Checklist"}
                  <span className="muted"> · {triggerLabel(c)}</span>
                </span>
                <span className="small muted">{when(c.completed_at) ?? "✓"}</span>
              </Link>
            ))}
          </div>
          <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>
            Full history is in each checklist and in Reports.
          </p>
        </div>
      )}

      {showManualCheckin && (
        <ManualCheckinDialog onClose={() => setShowManualCheckin(false)} />
      )}
    </div>
  );
}

// Every tour, rendered as an inline section — the guard typically has one,
// and its steps belong on the same page as the checklists that trigger at
// its checkpoints. Tours with work left sort above finished ones.
function ToursInline() {
  const { data: tours } = useTours();
  const { data: tourCheckpoints } = useTourCheckpoints();
  const { activeShift, visitedIds } = useShiftVisits();
  if (tours.length === 0) return null;

  const ranked = [...tours].sort((a, b) => {
    const rem = (t: (typeof tours)[number]) =>
      tourCheckpoints.filter((c) => c.tour_id === t.id && !visitedIds.has(c.id))
        .length;
    return (
      (rem(a) === 0 ? 1 : 0) - (rem(b) === 0 ? 1 : 0) ||
      a.name.localeCompare(b.name)
    );
  });

  return (
    <div className="stack" style={{ gap: 18 }}>
      {!activeShift && (
        <p className="muted small" style={{ margin: 0 }}>
          Start a shift from the Dashboard to track tour progress — visits
          reset each shift.
        </p>
      )}
      {ranked.map((t) => (
        <TourSection
          key={t.id}
          tour={t}
          checkpoints={tourCheckpoints.filter((c) => c.tour_id === t.id)}
          shiftId={activeShift?.id}
          visitedIds={visitedIds}
        />
      ))}
    </div>
  );
}
