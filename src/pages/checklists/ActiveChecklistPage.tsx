import { useEffect, useRef } from "react";
import type { ComponentType } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { ITEM_TYPE_LABEL, type ItemType } from "../../lib/checklists";
import { activityTx } from "../../lib/activityLog";
import {
  DoorCheckItem,
  LocationCheckItem,
  MeterReadingItem,
  SimpleCheckItem,
  VerifyTaskItem,
  type ItemProps,
} from "./checklistItems";

// Checklists & Tours — Active Checklist (see pages/active-checklist.html).
// Item-by-item completion of an in-progress instance; every write here is
// local-first InstantDB, so it works fully offline.
export function ActiveChecklistPage() {
  const { id: checklistId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const current = useCurrent();
  const isMobile = useIsMobile();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;

  const { data } = db.useQuery(
    checklistId
      ? {
          checklists: {
            $: { where: { id: checklistId } },
            template: { items: {} },
            itemResults: { templateItem: {}, linkedTicket: {} },
            assignedTo: {},
            endedShift: {},
          },
        }
      : null,
  );
  const checklist = data?.checklists?.[0];

  // Opening a Not Started checklist starts it — and, for a role-assigned
  // instance nobody has claimed yet, claims it for whoever opened it (see
  // pages/checklist-list.html — "opens (and implicitly claims) it"). Keyed by
  // checklist id since navigating into a nested Location-Based Check reuses
  // this same route/component with a different id.
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!checklist || started.current === checklist.id) return;
    const needsStart = checklist.status === "not_started";
    const needsClaim = !checklist.assignedTo && Boolean(current.user);
    if (!needsStart && !needsClaim) return;
    started.current = checklist.id;
    let update = db.tx.checklists[checklist.id].update({
      ...(needsStart ? { status: "in_progress", startedAt: Date.now() } : {}),
    });
    if (needsClaim) update = update.link({ assignedTo: current.user!.id });
    void db.transact(update);
  }, [checklist, current.user]);

  if (!checklist) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  if (checklist.status === "complete") {
    navigate(`/checklists/${checklist.id}`, { replace: true });
    return null;
  }

  const items = (checklist.template?.items ?? [])
    .slice()
    .sort((a, b) => a.order - b.order);
  const resultByItemId = new Map(
    (checklist.itemResults ?? []).map((r) => [r.templateItem?.id, r]),
  );

  const locationCheckNestedIds = items
    .filter((i) => i.type === "location_check")
    .map((i) => resultByItemId.get(i.id))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map((r) => (r.result as { nestedChecklistId?: string })?.nestedChecklistId)
    .filter((v): v is string => Boolean(v));

  const { data: nestedData } = db.useQuery(
    locationCheckNestedIds.length > 0
      ? { checklists: { $: { where: { id: { $in: locationCheckNestedIds } } } } }
      : null,
  );
  const nestedStatusById = new Map(
    (nestedData?.checklists ?? []).map((c) => [c.id, c.status]),
  );

  const isDone = (itemId: string, type: string) => {
    const r = resultByItemId.get(itemId);
    if (!r) return false;
    if (type === "location_check") {
      const nestedId = (r.result as { nestedChecklistId?: string })?.nestedChecklistId;
      return nestedId ? nestedStatusById.get(nestedId) === "complete" : false;
    }
    return true;
  };

  const remaining = items.filter((i) => !isDone(i.id, i.type)).length;
  const allDone = items.length > 0 && remaining === 0;

  const submit = async () => {
    const templateName = checklist.template?.name ?? "Checklist";
    await db.transact([
      db.tx.checklists[checklist.id].update({ status: "complete", completedAt: Date.now() }),
      activityTx({
        eventType: "checklist.completed",
        summary: `"${templateName}" completed`,
        subjectType: "checklists",
        subjectId: checklist.id,
        actorId: current.user?.id,
      }),
      ...(checklist.endedShift
        ? [
            db.tx.shifts[checklist.endedShift.id].update({ endedAt: Date.now() }),
            activityTx({
              eventType: "shift.ended",
              summary: `Shift ended by end-of-shift checklist "${templateName}"`,
              subjectType: "shifts",
              subjectId: checklist.endedShift.id,
              actorId: current.user?.id,
            }),
          ]
        : []),
    ]);
    navigate(returnTo ?? "/checklists");
  };

  const componentFor = (type: string): ComponentType<ItemProps> => {
    switch (type as ItemType) {
      case "simple_check":
        return SimpleCheckItem;
      case "verify_task":
        return VerifyTaskItem;
      case "door_check":
        return DoorCheckItem;
      case "location_check":
        return LocationCheckItem;
      case "meter_reading":
        return MeterReadingItem;
      default:
        return () => <div className="card">Unknown item type: {type}</div>;
    }
  };

  const visibleItems =
    isMobile && !allDone
      ? items.slice(0, items.findIndex((i) => !isDone(i.id, i.type)) + 1).slice(-1)
      : items;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{checklist.template?.name ?? "Checklist"}</h1>
          {isMobile && items.length > 0 && (
            <div className="page-sub">
              Item {items.length - remaining + (allDone ? 0 : 1)} of {items.length}
            </div>
          )}
        </div>
      </div>

      <div className={isMobile ? "stack" : "grid-2"}>
        {visibleItems.map((item) => {
          const Component = componentFor(item.type);
          return (
            <Component
              key={item.id}
              item={item}
              existing={resultByItemId.get(item.id)}
              checklistId={checklist.id}
              onSaved={() => {}}
            />
          );
        })}
      </div>

      {items.length === 0 && (
        <div className="placeholder">
          <div className="big">This checklist has no items</div>
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!allDone}
          onClick={() => void submit()}
        >
          {allDone
            ? "Submit Checklist"
            : `Submit Checklist — ${remaining} item${remaining === 1 ? "" : "s"} remaining`}
        </button>
      </div>

      <p className="muted small" style={{ marginTop: 10 }}>
        Every item type here — {Object.values(ITEM_TYPE_LABEL).join(", ")} — writes locally
        first and syncs automatically; leaving and resuming later preserves exact progress.
      </p>
    </div>
  );
}
