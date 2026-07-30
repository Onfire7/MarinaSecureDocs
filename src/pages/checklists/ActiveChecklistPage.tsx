import { useEffect, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import {
  ITEM_TYPE_LABEL,
  isStateCheck,
  normalizeItemType,
  type DoorCheckConfig,
  type ItemType,
  type TriggeredBy,
} from "../../lib/checklists";
import { activityTx } from "../../lib/activityLog";
import {
  buildPendingEffectTxns,
  collectPendingEffects,
} from "../../lib/checklistSubmit";
import {
  DoorCheckItem,
  LockCheckItem,
  LocationCheckItem,
  MeterReadingItem,
  SimpleCheckItem,
  VerifyTaskItem,
  type ItemProps,
} from "./checklistItems";

// Checklists & Tours — Active Checklist (see pages/active-checklist.html).
// Item-by-item completion of an in-progress instance; every write here is
// local-first InstantDB, so it works fully offline. The route wrapper below
// just supplies the id and where to go afterward — ChecklistItemsPanel is
// also embedded directly (compact, no navigation) by CheckpointScanModal, so
// a checkpoint with one checklist (the common case) can be worked right from
// the scan overlay instead of tapping through to this page.
export function ActiveChecklistPage() {
  const { id: checklistId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;

  if (!checklistId) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  return (
    <ChecklistItemsPanel
      checklistId={checklistId}
      onSubmitted={() => navigate(returnTo ?? "/checklists")}
      onComplete={() => navigate(`/checklists/${checklistId}`, { replace: true })}
    />
  );
}

export function ChecklistItemsPanel({
  checklistId,
  onSubmitted,
  onComplete,
  compact = false,
}: {
  checklistId: string;
  /** Called right after a successful submit — optional since compact mode's
   *  own "complete" branch above already reflects it, nothing else to do. */
  onSubmitted?: () => void;
  /**
   * Called when the checklist turns out to already be complete (someone
   * else finished it, or this same submit just did). Full-page mode hands
   * off to the read-only detail page; compact mode ignores this — the
   * "complete" branch below already renders its own small summary in place.
   */
  onComplete?: () => void;
  /** Embedded inline (CheckpointScanModal) rather than as its own page. */
  compact?: boolean;
}) {
  const current = useCurrent();
  const isMobile = useIsMobile();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data } = db.useQuery({
    checklists: {
      $: { where: { id: checklistId } },
      template: { items: {} },
      itemResults: { templateItem: {}, linkedTicket: {} },
      assignedTo: {},
      endedShift: {},
    },
  });
  const checklist = data?.checklists?.[0];

  // Opening a Not Started checklist starts it — and, for a role-assigned
  // instance nobody has claimed yet, claims it for whoever opened it (see
  // pages/checklist-list.html — "opens (and implicitly claims) it"). Keyed by
  // checklist id since navigating into a nested Location-Based Check reuses
  // this same component with a different id.
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

  // Some checklists span several nearby buildings in one pass (e.g. one
  // "Resturaunt" checklist covering The Point, Parlor Room, and the Condo,
  // each with their own Front/Side Door items) — a door/lock check away from
  // the checkpoint's own location gets a small header naming which one it's
  // at, so "Front Door" at one building doesn't read as the same card as
  // "Front Door" at another. Nothing to compare against for a non-checkpoint
  // trigger (clock in/out, manual, scheduled), so this is a no-op there.
  const triggeredBy = checklist?.triggeredBy as TriggeredBy | undefined;
  const checkpointId = triggeredBy?.type === "checkpoint" ? triggeredBy.checkpointId : undefined;
  const { data: checkpointData } = db.useQuery(
    checkpointId ? { checkpoints: { $: { where: { id: checkpointId } }, location: {} } } : null,
  );
  const checkpointLocationId = checkpointData?.checkpoints?.[0]?.location?.id;

  const itemLocationId = (item: (typeof items)[number]): string | undefined =>
    isStateCheck(item.type) ? (item.config as DoorCheckConfig | undefined)?.locationId : undefined;

  // Without a resolved checkpoint location there's no baseline to call
  // anything "off-site" relative to — treating every item's own location as
  // a deviation would header even a single-location checklist the moment it
  // wasn't checkpoint-triggered (or the checkpoint simply has no location).
  const offSiteLocationIds = checkpointLocationId
    ? [
        ...new Set(
          items
            .map(itemLocationId)
            .filter((id): id is string => Boolean(id) && id !== checkpointLocationId),
        ),
      ]
    : [];
  const { data: offSiteLocationsData } = db.useQuery(
    offSiteLocationIds.length > 0
      ? { locations: { $: { where: { id: { $in: offSiteLocationIds } } } } }
      : null,
  );
  const offSiteLocationNameById = new Map(
    (offSiteLocationsData?.locations ?? []).map((l) => [l.id, l.name]),
  );

  if (!checklist) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  if (checklist.status === "complete") {
    if (compact) {
      return (
        <div className="card card-done">
          <div className="card-title">{checklist.template?.name ?? "Checklist"}</div>
          <div className="card-meta">Complete</div>
        </div>
      );
    }
    onComplete?.();
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
    onSubmitted?.();
  };

  const componentFor = (type: string): ComponentType<ItemProps> => {
    switch (normalizeItemType(type) as ItemType) {
      case "simple_check":
        return SimpleCheckItem;
      case "verify_task":
        return VerifyTaskItem;
      case "door_check":
        return DoorCheckItem;
      case "lock_check":
        return LockCheckItem;
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
      {compact ? (
        <div className="spread" style={{ alignItems: "baseline" }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            {checklist.template?.name ?? "Checklist"}
          </div>
          {items.length > 0 && (
            <span className="muted small">
              {items.length - remaining} of {items.length} complete
            </span>
          )}
        </div>
      ) : (
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
      )}

      <div
        className={isMobile || compact ? "stack" : "grid-2"}
        style={compact ? { marginTop: 8 } : undefined}
      >
        {(() => {
          const spansColumns = !isMobile && !compact;
          const nodes: ReactNode[] = [];
          // A header appears once per run of consecutive items at the same
          // off-site location — not once per card, and not again immediately
          // after returning to it, only once the run is actually broken by a
          // different location (including "back at the checkpoint's own").
          let previousLocationId = checkpointLocationId;
          for (const item of items) {
            const locationId = itemLocationId(item) ?? checkpointLocationId;
            if (locationId !== checkpointLocationId && locationId !== previousLocationId) {
              const name = offSiteLocationNameById.get(locationId!);
              if (name) {
                nodes.push(
                  <div
                    key={`loc-${item.id}`}
                    className="group-heading"
                    style={spansColumns ? { gridColumn: "1 / -1" } : undefined}
                  >
                    <span>{name}</span>
                  </div>,
                );
              }
            }
            previousLocationId = locationId;

            const Component = componentFor(item.type);
            nodes.push(
              <Component
                key={item.id}
                item={item}
                existing={resultByItemId.get(item.id)}
                checklistId={checklist.id}
                onSaved={() => {}}
              />,
            );
          }
          return nodes;
        })()}
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

      <div className="row" style={{ marginTop: compact ? 10 : 16 }}>
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

      {!compact && (
        <p className="muted small" style={{ marginTop: 10 }}>
          Every item type here — {Object.values(ITEM_TYPE_LABEL).join(", ")} — writes locally
          first and syncs automatically; leaving and resuming later preserves exact progress.
        </p>
      )}
    </div>
  );
}
