import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { activityTx } from "../../lib/activityLog";
import { triggeredByLabel, type TriggeredBy } from "../../lib/checklists";
import { ManualCheckinDialog } from "./ManualCheckinDialog";
import { useShiftVisits } from "./useShiftVisits";

// Checklists & Tours — Checklist List (see pages/checklist-list.html).
//
// A guard's work queue, not an audit table. Open work — in-progress and
// not-started checklists, tours with unvisited checkpoints — sits front and
// center as tappable cards; finished work drops into a collapsed section at
// the bottom. The old layout was the reverse: a four-column metadata table
// defaulting to "All", where this shift's completions crowded out the row
// that actually needed attention. History lives in Reports and each
// checklist's own detail page, so this screen only owes a glance backwards.
export function ChecklistListPage() {
  const current = useCurrent();
  const navigate = useNavigate();
  const userId = current.user?.id;
  const isSecurity = current.roleNames.includes("Security");
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<"checklists" | "tours">("checklists");
  const [showManualCheckin, setShowManualCheckin] = useState(false);
  const [starting, setStarting] = useState<string | null>(null);
  const [manualTemplateId, setManualTemplateId] = useState("");
  const showChecklists = !isMobile || mobileTab === "checklists";
  const showTours = isSecurity && (!isMobile || mobileTab === "tours");

  const roleIds = (current.user?.roles ?? []).map((r) => r.id);

  const { data: manualTemplateData } = db.useQuery({
    checklistTemplates: {
      $: { where: { triggerType: "manual" } },
      role: {},
      creator: {},
    },
  });
  const manualTemplates = (manualTemplateData?.checklistTemplates ?? []).filter((t) => {
    if (t.visibility === "personal") return t.creator?.id === userId;
    if (t.visibility === "role_restricted") return t.role && roleIds.includes(t.role.id);
    return true;
  });

  const startChecklist = async (template: (typeof manualTemplates)[number]) => {
    if (!userId || starting) return;
    setStarting(template.id);
    const checklistId = id();
    await db.transact([
      db.tx.checklists[checklistId]
        .update({ status: "not_started", triggeredBy: { type: "manual" } })
        .link({
          template: template.id,
          ...(template.assignmentMode === "triggering_user" ? { assignedTo: userId } : {}),
        }),
      activityTx({
        eventType: "checklist.started",
        summary: `${template.name} started manually by ${current.user?.name ?? "a user"}`,
        subjectType: "checklists",
        subjectId: checklistId,
        actorId: userId,
      }),
    ]);
    setStarting(null);
    navigate(`/checklists/${checklistId}`);
  };

  const { data: mineData } = db.useQuery(
    userId
      ? {
          checklists: {
            $: { where: { "assignedTo.id": userId } },
            template: {},
          },
        }
      : null,
  );
  const { data: unclaimedData } = db.useQuery(
    roleIds.length > 0
      ? {
          checklists: {
            $: {
              where: {
                assignedTo: { $isNull: true },
                status: { $in: ["not_started", "in_progress"] },
                "template.role.id": { $in: roleIds },
              },
            },
            template: {},
          },
        }
      : null,
  );

  const checklists = useMemo(() => {
    const mine = mineData?.checklists ?? [];
    const unclaimed = unclaimedData?.checklists ?? [];
    const seen = new Set(mine.map((c) => c.id));
    return [...mine, ...unclaimed.filter((c) => !seen.has(c.id))];
  }, [mineData, unclaimedData]);

  const checkpointIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of checklists) {
      const t = c.triggeredBy as TriggeredBy | undefined;
      if (t?.type === "checkpoint") ids.add(t.checkpointId);
    }
    return [...ids];
  }, [checklists]);
  const { data: cpData } = db.useQuery(
    checkpointIds.length > 0
      ? { checkpoints: { $: { where: { id: { $in: checkpointIds } } } } }
      : null,
  );
  const checkpointNameById = new Map(
    (cpData?.checkpoints ?? []).map((c) => [c.id, c.name]),
  );

  const triggerLabel = (c: (typeof checklists)[number]) =>
    triggeredByLabel(
      c.triggeredBy as TriggeredBy | undefined,
      (c.triggeredBy as TriggeredBy | undefined)?.type === "checkpoint"
        ? checkpointNameById.get(
            (c.triggeredBy as { checkpointId: string }).checkpointId,
          )
        : undefined,
    );

  // In-progress outranks not-started: half-done work goes stale in a way
  // unstarted work doesn't.
  const open = checklists
    .filter((c) => c.status === "in_progress" || c.status === "not_started")
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

      {isSecurity && isMobile && (
        <div className="chip-row">
          <button
            type="button"
            className={"chip" + (mobileTab === "checklists" ? " active" : "")}
            onClick={() => setMobileTab("checklists")}
          >
            Checklists
          </button>
          <button
            type="button"
            className={"chip" + (mobileTab === "tours" ? " active" : "")}
            onClick={() => setMobileTab("tours")}
          >
            Tours
          </button>
        </div>
      )}

      <div className={isSecurity ? "grid-2" : undefined}>
        {showChecklists && (
          <div>
            <div className="stack">
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
              <div className="placeholder">
                <div className="big">Nothing to do right now</div>
                {checklists.length === 0
                  ? roleIds.length === 0
                    ? "You hold no roles with checklist assignments."
                    : "Check back once a checkpoint visit, schedule, or clock event triggers one."
                  : "Everything assigned to you is complete."}
              </div>
            )}

            {completed.length > 0 && (
              <details className="section-collapse" style={{ marginTop: 14 }}>
                <summary>
                  <span className="section-title" style={{ marginBottom: 0 }}>
                    Completed · {completed.length}
                    {checklists.filter((c) => c.status === "complete").length >
                      RECENT_COMPLETED && " most recent"}
                  </span>
                </summary>
                <div className="stack" style={{ gap: 4, marginTop: 8 }}>
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
              </details>
            )}
          </div>
        )}

        {showTours && (
          <div>
            <ToursPanel />
          </div>
        )}
      </div>

      {showManualCheckin && (
        <ManualCheckinDialog onClose={() => setShowManualCheckin(false)} />
      )}
    </div>
  );
}

function ToursPanel() {
  const { data } = db.useQuery({ tours: { checkpoints: {} } });
  const { activeShift, visitedIds } = useShiftVisits();
  const tours = data?.tours ?? [];

  // Tours with work left float above finished ones — same rule as the
  // checklist column: open in front, done in the background.
  const ranked = [...tours]
    .map((t) => {
      const total = (t.checkpoints ?? []).length;
      const remaining = (t.checkpoints ?? []).filter(
        (c) => !visitedIds.has(c.id),
      ).length;
      return { tour: t, total, remaining };
    })
    .sort(
      (a, b) =>
        (a.remaining === 0 ? 1 : 0) - (b.remaining === 0 ? 1 : 0) ||
        a.tour.name.localeCompare(b.tour.name),
    );

  return (
    <div>
      <div className="section-title">
        Tours <span className="badge badge-accent">Security</span>
      </div>
      {tours.length === 0 && (
        <div className="placeholder">
          <div className="big">No tours configured</div>
          Set these up in Admin → Tours setup.
        </div>
      )}
      {tours.length > 0 && !activeShift && (
        <p className="muted small" style={{ marginBottom: 8 }}>
          Start a shift from the Dashboard to track progress — visits reset
          each shift.
        </p>
      )}
      <div className="stack">
        {ranked.map(({ tour: t, total, remaining }) => {
          const done = activeShift && total > 0 && remaining === 0;
          return (
            <Link
              key={t.id}
              to={`/checklists/tours/${t.id}`}
              className="card"
              style={{
                textDecoration: "none",
                color: "inherit",
                ...(done ? { opacity: 0.6 } : {}),
              }}
            >
              <div className="spread">
                <span className="card-title">{t.name}</span>
                {activeShift && total > 0 && (
                  <span className={"badge" + (done ? " badge-good" : " badge-warn")}>
                    {done ? "Complete ✓" : `${remaining} left`}
                  </span>
                )}
              </div>
              <div className="card-meta">
                {modeLabel(t.mode)} · {total} checkpoint{total === 1 ? "" : "s"}
              </div>
              {activeShift && total > 0 && (
                <div className="progress-track" style={{ marginTop: 8 }}>
                  <div
                    className="progress-fill"
                    style={{ width: `${((total - remaining) / total) * 100}%` }}
                  />
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function modeLabel(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}
