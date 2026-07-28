import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { ITEM_TYPE_LABEL, type ItemType } from "../../lib/checklists";
import { activityTx } from "../../lib/activityLog";
import {
  buildPendingEffectTxns,
  collectPendingEffects,
} from "../../lib/checklistSubmit";
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
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
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

  // Every hook below must run on every render regardless of whether the
  // checklist has loaded yet — a hook after the "not loaded" early return
  // used to only run once data arrived, changing the hook count between
  // renders (React error #310). Computed off optional chaining instead so
  // the shape is stable: empty items/no nested query while loading, real
  // values once `checklist` resolves.
  const items = (checklist?.template?.items ?? [])
    .slice()
    .sort((a, b) => a.order - b.order);
  const resultByItemId = new Map(
    (checklist?.itemResults ?? []).map((r) => [r.templateItem?.id, r]),
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
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await runSubmit();
    } catch (err) {
      // A failed submit now also means the incidents and tickets this
      // checklist raised were never written — the guard has to know.
      setSubmitError(
        err instanceof Error ? err.message : "Couldn't submit the checklist.",
      );
      setSubmitting(false);
    }
  };

  const runSubmit = async () => {
    const templateName = checklist.template?.name ?? "Checklist";
    // Everything the items described while the guard worked — incidents,
    // tickets, meter readings — is written here, in the same transaction
    // that completes the checklist. Until this point an item could still be
    // reopened and changed, which is only safe because none of it existed.
    const collected = collectPendingEffects(checklist.itemResults ?? []);
    const effectTxns = await buildPendingEffectTxns(collected, current.user?.id);
    await db.transact([
      ...effectTxns,
      // Link each raised ticket back to the item result that raised it.
      ...[...collected.ticketByResultId].map(([resultId, ticketId]) =>
        db.tx.checklistItemResults[resultId].link({ linkedTicket: ticketId }),
      ),
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

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{checklist.template?.name ?? "Checklist"}</h1>
          {items.length > 0 && (
            <div className="page-sub">
              {items.length - remaining} of {items.length} complete
            </div>
          )}
        </div>
      </div>

      <div className={isMobile ? "stack" : "grid-2"}>
        {items.map((item) => {
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

      {submitError && (
        <div className="badge badge-bad" style={{ display: "block", marginTop: 12 }}>
          {submitError}
        </div>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!allDone || submitting}
          onClick={() => void submit()}
        >
          {submitting
            ? "Submitting…"
            : allDone
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
