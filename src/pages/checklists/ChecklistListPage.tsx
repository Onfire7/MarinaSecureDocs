import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { activityTx } from "../../lib/activityLog";
import { deterministicId } from "../../lib/detId";
import { eligibleToday, isVisibleNow, triggerTypeLabel } from "../../lib/checklists";
import {
  buildInstanceTx,
  TEMPLATE_INSTANTIATION_QUERY,
} from "../../lib/checklistInstantiation";
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
  const [manualTemplateId, setManualTemplateId] = useState("");

  const roleIds = (current.user?.roles ?? []).map((r) => r.id);

  // Manual templates feed the Start button; recurring ones feed the
  // auto-create effect below. Both need the full instantiation shape.
  const { data: templateData } = db.useQuery({
    checklistTemplates: {
      $: { where: { triggerType: { $in: ["manual", "recurring"] } } },
      ...TEMPLATE_INSTANTIATION_QUERY,
    },
  });
  const myTemplates = (templateData?.checklistTemplates ?? []).filter(
    (t) => t.assignedRole && roleIds.includes(t.assignedRole.id),
  );
  const manualTemplates = myTemplates.filter((t) => t.triggerType === "manual");

  const startChecklist = async (template: (typeof manualTemplates)[number]) => {
    if (!userId || starting) return;
    setStarting(template.id);
    const instanceId = id();
    await db.transact([
      ...buildInstanceTx({ template, instanceId, userId }),
      activityTx({
        eventType: "checklist.started",
        summary: `${template.name} started manually by ${current.user?.name ?? "a user"}`,
        subjectType: "checklistInstances",
        subjectId: instanceId,
        actorId: userId,
      }),
    ]);
    setStarting(null);
    navigate(`/checklists/${instanceId}`);
  };

  // ---- Recurring auto-create ----
  // One instance per template per local day, id derived from both so any
  // number of role-holders opening the page create it exactly once. Pinned
  // to the day this page mounted — a client left open across midnight picks
  // the new day up on its next visit here, which is fine: creation is
  // usage-driven by design.
  const [today] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  });
  const dueToday = myTemplates.filter(
    (t) => t.triggerType === "recurring" && eligibleToday(t),
  );
  const expectedRecurringIds = dueToday.map((t) =>
    deterministicId(`recurring:${t.id}:${today}`),
  );
  const { data: existingRecurringData } = db.useQuery(
    expectedRecurringIds.length > 0
      ? {
          checklistInstances: {
            $: { where: { id: { $in: expectedRecurringIds } } },
          },
        }
      : null,
  );
  const creatingRecurring = useRef(false);
  useEffect(() => {
    if (!userId || creatingRecurring.current) return;
    if (dueToday.length === 0 || !existingRecurringData) return;
    const existing = new Set(
      (existingRecurringData.checklistInstances ?? []).map((c) => c.id),
    );
    const missing = dueToday.filter(
      (t) => !existing.has(deterministicId(`recurring:${t.id}:${today}`)),
    );
    if (missing.length === 0) return;
    creatingRecurring.current = true;
    void db
      .transact(
        missing.flatMap((t) => {
          const instanceId = deterministicId(`recurring:${t.id}:${today}`);
          return [
            ...buildInstanceTx({ template: t, instanceId, userId }),
            activityTx({
              eventType: "checklist.created",
              summary: `${t.name} created on its recurring schedule`,
              subjectType: "checklistInstances",
              subjectId: instanceId,
              actorId: userId,
            }),
          ];
        }),
      )
      .catch(console.error);
  }, [userId, dueToday, existingRecurringData, today]);

  const { data: mineData } = db.useQuery(
    userId
      ? {
          checklistInstances: {
            $: {
              where: {
                "assignedTo.id": userId,
                parentItem: { $isNull: true },
              },
            },
            template: {},
          },
        }
      : null,
  );
  const { data: unclaimedData } = db.useQuery(
    roleIds.length > 0
      ? {
          checklistInstances: {
            $: {
              where: {
                assignedTo: { $isNull: true },
                status: { $in: ["not_started", "in_progress"] },
                "template.assignedRole.id": { $in: roleIds },
                parentItem: { $isNull: true },
              },
            },
            template: {},
          },
        }
      : null,
  );
  // Read-only monitoring: instances of templates whose viewerRoles include
  // one of mine but whose assignedRole doesn't — e.g. the office watching
  // maintenance work through. Client-side only until the perms overhaul.
  const { data: viewerData } = db.useQuery(
    roleIds.length > 0
      ? {
          checklistInstances: {
            $: {
              where: {
                "template.viewerRoles.id": { $in: roleIds },
                status: { $in: ["not_started", "in_progress"] },
                parentItem: { $isNull: true },
              },
            },
            template: { assignedRole: {} },
            assignedTo: {},
          },
        }
      : null,
  );

  const checklists = useMemo(() => {
    const mine = mineData?.checklistInstances ?? [];
    const unclaimed = unclaimedData?.checklistInstances ?? [];
    const seen = new Set(mine.map((c) => c.id));
    return [...mine, ...unclaimed.filter((c) => !seen.has(c.id))];
  }, [mineData, unclaimedData]);

  const monitoring = useMemo(() => {
    const actionable = new Set(checklists.map((c) => c.id));
    return (viewerData?.checklistInstances ?? []).filter(
      (c) =>
        !actionable.has(c.id) &&
        !(c.template?.assignedRole && roleIds.includes(c.template.assignedRole.id)) &&
        isVisibleNow(c),
    );
    // roleIds is rebuilt per render but stable in value; the memo exists for
    // the Set, not referential purity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerData, checklists]);

  const triggerLabel = (c: (typeof checklists)[number]) =>
    triggerTypeLabel(c.template?.triggerType);

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
      return (b.startedAt ?? 0) > (a.startedAt ?? 0) ? 1 : -1;
    });

  // Backgrounded, not hidden — enough to confirm "yes, that one went
  // through" without scrolling this shift's completions above open work.
  // Older history belongs to Reports and the checklist's own detail page.
  const RECENT_COMPLETED = 15;
  const completed = checklists
    .filter((c) => c.status === "complete")
    .sort((a, b) => ((b.completedAt ?? 0) > (a.completedAt ?? 0) ? 1 : -1))
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
                    <span className="card-title">{c.template?.name ?? "Checklist"}</span>
                    <span className="card-meta" style={{ display: "block" }}>
                      {triggerLabel(c)}
                      {c.startedAt && ` · started ${when(c.startedAt)}`}
                      {c.dueBy && ` · due ${when(c.dueBy)}`}
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
                        {c.template?.name ?? "Checklist"}
                        <span className="muted">
                          {" · "}
                          {c.assignedTo?.name ??
                            c.template?.assignedRole?.name ??
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
                  {c.template?.name ?? "Checklist"}
                  <span className="muted"> · {triggerLabel(c)}</span>
                </span>
                <span className="small muted">{when(c.completedAt) ?? "✓"}</span>
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
  const { data } = db.useQuery({
    tours: { checkpoints: { location: {} } },
  });
  const { activeShift, visitedIds } = useShiftVisits();
  const tours = data?.tours ?? [];
  if (tours.length === 0) return null;

  const ranked = [...tours].sort((a, b) => {
    const rem = (t: (typeof tours)[number]) =>
      (t.checkpoints ?? []).filter((c) => !visitedIds.has(c.id)).length;
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
          shiftId={activeShift?.id}
          visitedIds={visitedIds}
        />
      ))}
    </div>
  );
}
