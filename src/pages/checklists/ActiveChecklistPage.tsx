import { useRef, useState } from "react";
import { useEffect } from "react";
import type { ComponentType, ReactNode } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import {
  isStateCheck,
  isVisibleNow,
  normalizeItemType,
  type DoorCheckConfig,
  type ItemType,
} from "../../lib/checklists";
import { activityTx } from "../../lib/activityLog";
import { ReorderableList } from "../shared/ReorderableList";
import {
  buildPendingEffectTxns,
  collectPendingEffects,
} from "../../lib/checklistSubmit";
import {
  DoorCheckItem,
  LockCheckItem,
  LocationCheckItem,
  MeterReadingItem,
  QuestionItem,
  SimpleCheckItem,
  VerifyTaskItem,
  type ItemProps,
} from "./checklistItems";

// Checklists & Tours — Active Checklist (see pages/active-checklist.html).
// Item-by-item completion of an in-progress instance; every write here is
// local-first InstantDB, so it works fully offline. An instance is fully
// materialized rows — sections and items exist in the database from the
// moment they were assigned — so this page renders exactly what's stored:
// no template resolution, no activation windows, just rows, with sections
// still inside their hideUntil filtered out until their moment arrives.
//
// The route wrapper below just supplies the id and where to go afterward —
// ChecklistItemsPanel is also embedded directly (compact, scoped to one
// section) by the checkpoint screens, so the section a scan opened can be
// worked right at the checkpoint instead of tapping through to this page.
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
  sectionId,
  onSubmitted,
  onComplete,
  compact = false,
}: {
  checklistId: string;
  /**
   * Render just this one instance section — the checkpoint screens embed the
   * section a scan opened, headed by its parent checklist's name, rather
   * than the whole checklist.
   */
  sectionId?: string;
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
  /** Embedded inline (checkpoint screens) rather than as its own page. */
  compact?: boolean;
}) {
  const current = useCurrent();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Only the sections someone has opened or shut by hand. Everything else
  // follows its own completion, so a section folds itself away as the last
  // item in it is answered and the next one is the one in front of you.
  const [sectionOverride, setSectionOverride] = useState<Record<string, boolean>>({});
  // Arms the second tap that submits with work outstanding.
  const [confirmingPartial, setConfirmingPartial] = useState(false);

  const { data } = db.useQuery({
    checklistInstances: {
      $: { where: { id: checklistId } },
      template: { assignedRole: {} },
      sections: {
        location: {},
        items: { template: {}, completedBy: {} },
      },
      assignedTo: {},
      endedShift: {},
      parentItem: {},
    },
  });
  const checklist = data?.checklistInstances?.[0];

  // Who may work this checklist: its assignee, any holder of the template's
  // assignedRole, or anyone at all if the template somehow has no role (the
  // orphan guard). viewerRoles members and other onlookers get a read-only
  // rendering — client-side only until the permissions overhaul.
  const roleIds = (current.user?.roles ?? []).map((r) => r.id);
  const userId = current.user?.id;
  const canAct = Boolean(
    checklist &&
      userId &&
      (checklist.assignedTo?.id === userId ||
        !checklist.template?.assignedRole ||
        roleIds.includes(checklist.template.assignedRole.id)),
  );

  // Opening a Not Started checklist starts it — and, for a role-assigned
  // instance nobody has claimed yet, claims it for whoever opened it (see
  // pages/checklist-list.html — "opens (and implicitly claims) it"). Keyed by
  // checklist id since navigating into a nested Location-Based Check reuses
  // this same component with a different id. Read-only viewers do neither.
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (!checklist || !canAct || started.current === checklist.id) return;
    // The checkpoint screens embed single sections of a checklist the guard
    // is only passing through — working a section shouldn't claim the whole
    // nightly checklist for them, only deliberate opens do that.
    if (sectionId) return;
    const needsStart = checklist.status === "not_started";
    const needsClaim = !checklist.assignedTo && Boolean(current.user);
    if (!needsStart && !needsClaim) return;
    started.current = checklist.id;
    let update = db.tx.checklistInstances[checklist.id].update({
      ...(needsStart ? { status: "in_progress", startedAt: Date.now() } : {}),
    });
    if (needsClaim) update = update.link({ assignedTo: current.user!.id });
    void db.transact(update);
  }, [checklist, current.user, canAct, sectionId]);

  const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;
  // All hooks below must run on every render regardless of load state —
  // computed off optional chaining so the shape is stable while loading.
  const allSections = (checklist?.sections ?? []).slice().sort(byOrder);
  // Sections still inside their hideUntil exist but aren't anyone's work
  // yet. Their items still count toward "remaining" below — a checklist
  // can't be submitted before a section has even revealed itself.
  const hiddenSections = allSections.filter((s) => !isVisibleNow(s));
  const visibleSections = allSections
    .filter((s) => isVisibleNow(s))
    .filter((s) => (sectionId ? s.id === sectionId : true))
    .map((s) => ({
      ...s,
      items: (s.items ?? []).slice().sort(byOrder),
    }));

  const allItems = allSections.flatMap((s) => s.items ?? []);

  const locationCheckNestedIds = allItems
    .filter((i) => i.template?.type === "location_check")
    .map((i) => (i.result as { nestedChecklistId?: string } | undefined)?.nestedChecklistId)
    .filter((v): v is string => Boolean(v));

  const { data: nestedData } = db.useQuery(
    locationCheckNestedIds.length > 0
      ? {
          checklistInstances: {
            $: { where: { id: { $in: locationCheckNestedIds } } },
          },
        }
      : null,
  );
  const nestedStatusById = new Map(
    (nestedData?.checklistInstances ?? []).map((c) => [c.id, c.status]),
  );

  type ItemRow = (typeof allItems)[number];
  const itemLocationId = (item: ItemRow): string | undefined =>
    item.template && isStateCheck(item.template.type)
      ? (item.template.config as DoorCheckConfig | undefined)?.locationId
      : undefined;

  // A door/lock check away from its section's own location gets a small
  // header naming where it is — "Front Door" at one building shouldn't read
  // as the same card as "Front Door" at another. A section without a
  // location has no baseline, so every bound location headers there.
  const offSiteLocationIds = [
    ...new Set(
      allSections.flatMap((s) =>
        (s.items ?? [])
          .map(itemLocationId)
          .filter((id): id is string => Boolean(id) && id !== s.location?.id),
      ),
    ),
  ];
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

  const isDone = (item: ItemRow) => {
    if (item.result == null) return false;
    if (item.template?.type === "location_check") {
      const nestedId = (item.result as { nestedChecklistId?: string })?.nestedChecklistId;
      return nestedId ? nestedStatusById.get(nestedId) === "complete" : false;
    }
    return true;
  };

  // Submit gates on every item of every section — including ones still
  // hidden: their work exists, it just hasn't revealed yet.
  const remainingAll = allItems.filter((i) => !isDone(i)).length;
  const allDone = allItems.length > 0 && remainingAll === 0;
  const shownItems = visibleSections.flatMap((s) => s.items);
  const remainingShown = shownItems.filter((i) => !isDone(i)).length;

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
    const collected = collectPendingEffects(allItems);
    const effectTxns = await buildPendingEffectTxns(collected, current.user?.id);
    await db.transact([
      ...effectTxns,
      // Link each raised ticket back to the item that raised it.
      ...[...collected.ticketByResultId].map(([itemRowId, ticketId]) =>
        db.tx.checklistInstanceItems[itemRowId].link({ linkedTicket: ticketId }),
      ),
      db.tx.checklistInstances[checklist.id].update({
        status: "complete",
        completedAt: Date.now(),
      }),
      // A nested location-check instance completes its spawning item too, so
      // the parent's section completion time reflects when the sub-checklist
      // actually finished.
      ...(checklist.parentItem
        ? [
            db.tx.checklistInstanceItems[checklist.parentItem.id]
              .update({ completedAt: Date.now() })
              .link(current.user ? { completedBy: current.user.id } : {}),
          ]
        : []),
      activityTx({
        eventType: "checklist.completed",
        summary: `"${templateName}" completed`,
        subjectType: "checklistInstances",
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
      case "question":
        return QuestionItem;
      default:
        return () => <div className="card">Unknown item type: {type}</div>;
    }
  };

  // Reordering swaps the two rows' order values — the row order is the
  // guard's own working order from then on (it started as the template's).
  // One write per drop, and the row order becomes the user's own working
  // order from then on — it started as the template's.
  const reorderItems = (orderedIds: string[]) =>
    void db.transact(
      orderedIds.map((itemId, i) =>
        db.tx.checklistInstanceItems[itemId].update({ order: i }),
      ),
    );

  const title = checklist.template?.name ?? "Checklist";
  const sectionLabel = sectionId
    ? allSections.find((s) => s.id === sectionId)?.label
    : undefined;

  const dueText = (ts: number | string | null | undefined) =>
    ts
      ? new Date(ts).toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  return (
    <div>
      {compact ? (
        <div className="spread" style={{ alignItems: "baseline" }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            {title}
            {sectionLabel ? ` — ${sectionLabel}` : ""}
          </div>
          {shownItems.length > 0 && (
            <span className="muted small">
              {shownItems.length - remainingShown} of {shownItems.length} complete
            </span>
          )}
        </div>
      ) : (
        <div className="page-head">
          <div>
            <h1 className="page-title">{title}</h1>
            {shownItems.length > 0 && (
              <div className="page-sub">
                {shownItems.length - remainingShown} of {shownItems.length} complete
                {checklist.dueBy && ` · due ${dueText(checklist.dueBy)}`}
              </div>
            )}
          </div>
        </div>
      )}

      {!canAct && (
        <p className="muted small" style={{ marginTop: 4 }}>
          Read-only — this checklist belongs to{" "}
          {checklist.template?.assignedRole?.name ?? "another role"}.
        </p>
      )}

      <div
        className={isMobile || compact ? "stack" : "grid-2"}
        style={compact ? { marginTop: 8 } : undefined}
      >
        {(() => {
          const spansColumns = !isMobile && !compact;
          const nodes: ReactNode[] = [];
          // One heading is enough when there's nothing to tell apart: a
          // single section would just repeat the checklist's own title above
          // the only group of cards. A section embed already has its header.
          const showSectionHeadings = !sectionId && visibleSections.length > 1;

          // Finished sections sink. What's left to do is the whole point of
          // this screen, and a section you've completed shouldn't sit between
          // two you haven't.
          const isSectionDone = (sec: (typeof visibleSections)[number]) =>
            sec.items.length > 0 && sec.items.every((i) => isDone(i));
          const ordered = [
            ...visibleSections.filter((sec) => !isSectionDone(sec)),
            ...visibleSections.filter(isSectionDone),
          ];
          const firstDoneId = showSectionHeadings
            ? ordered.find(isSectionDone)?.id
            : undefined;

          for (const section of ordered) {
            if (section.id === firstDoneId) {
              nodes.push(
                <div
                  key="completed-separator"
                  className="group-heading completed-divider"
                  style={spansColumns ? { gridColumn: "1 / -1" } : undefined}
                >
                  <span className="section-title" style={{ marginBottom: 0 }}>
                    Completed
                  </span>
                </div>,
              );
            }
            const left = section.items.filter((i) => !isDone(i)).length;
            const sectionDone = section.items.length > 0 && left === 0;
            // Collapsing only means anything when there's more than one
            // section and a heading to click; a reorder in progress needs its
            // rows on screen whatever the section's state.
            const collapsible = showSectionHeadings;
            const collapsed =
              collapsible && (sectionOverride[section.id] ?? sectionDone);
            if (showSectionHeadings) {
              nodes.push(
                <div
                  key={`section-${section.id}`}
                  className="group-heading spread"
                  style={spansColumns ? { gridColumn: "1 / -1" } : undefined}
                >
                  <span className="row" style={{ minWidth: 0, gap: 6 }}>
                    {collapsible && (
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet disclosure-toggle"
                        aria-expanded={!collapsed}
                        aria-label={collapsed ? "Expand section" : "Collapse section"}
                        onClick={() =>
                          setSectionOverride((prev) => ({
                            ...prev,
                            [section.id]: !collapsed ? true : false,
                          }))
                        }
                      >
                        <svg
                          className="disclosure-caret"
                          viewBox="0 0 20 20"
                          width="18"
                          height="18"
                          aria-hidden="true"
                        >
                          <path
                            d="M5 7.5 10 12.5 15 7.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
                    <span style={{ minWidth: 0 }}>
                      {showSectionHeadings ? section.label : ""}
                      {showSectionHeadings && section.dueBy && (
                        <span className="muted small"> · due {dueText(section.dueBy)}</span>
                      )}
                      {collapsed && (
                        <span className="muted small">
                          {" "}
                          · {sectionDone
                            ? `all ${section.items.length} done`
                            : `${left} left`}
                        </span>
                      )}
                    </span>
                  </span>
                </div>,
              );
            }

            if (collapsed) continue;

            // A header appears once per run of consecutive items at the same
            // off-site location — not once per card, and not again immediately
            // after returning to it, only once the run is actually broken by a
            // different location. Reset per section so a run can't straddle a
            // section boundary.
            let previousLocationId = section.location?.id;
            // A location heading breaks the flow, so items are collected into
            // runs between headings — dragging is only meaningful within one.
            const runs: { items: typeof section.items }[] = [{ items: [] }];
            for (const item of section.items) {
              if (!item.template) continue;
              const locationId = itemLocationId(item) ?? section.location?.id;
              if (locationId !== section.location?.id && locationId !== previousLocationId) {
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
                  runs.push({ items: [] });
                }
              }
              previousLocationId = locationId;
              runs[runs.length - 1].items.push(item);
            }
            // Each run of items renders as its own draggable list, so a
            // grabber sits beside every card instead of a mode you enter and
            // leave. Runs span both columns: a two-up grid can't carry a
            // drag order that reads top to bottom.
            for (const run of runs) {
              if (run.items.length === 0) continue;
              nodes.push(
                <div
                  key={`run-${run.items[0].id}`}
                  style={spansColumns ? { gridColumn: "1 / -1" } : undefined}
                >
                  <ReorderableList
                    items={run.items}
                    enabled={canAct && !compact && section.items.length > 1}
                    onReorder={reorderItems}
                    renderItem={(item: (typeof run.items)[number]) => {
                      const Component = componentFor(item.template!.type);
                      return (
                        <Component
                          item={item.template!}
                          existing={item}
                          checklistId={checklist.id}
                          onSaved={() => {}}
                          editable={canAct}
                        />
                      );
                    }}
                  />
                </div>,
              );
            }
          }
          return nodes;
        })()}
      </div>

      {shownItems.length === 0 && (
        <div className="placeholder">
          <div className="big">
            {/* Distinguish an empty checklist from one whose sections are all
                still hidden — the second is the normal state of a time-gated
                checklist before its hours, not a misconfiguration. */}
            {allSections.length > 0
              ? "Nothing on this checklist is open yet"
              : "This checklist has no items"}
          </div>
        </div>
      )}

      {hiddenSections.length > 0 && !sectionId && (
        <p className="muted small" style={{ marginTop: 10 }}>
          {hiddenSections.length === 1
            ? `1 more section unlocks at ${dueText(hiddenSections[0].hideUntil) ?? "a later time"}.`
            : `${hiddenSections.length} more sections unlock later.`}
        </p>
      )}

      {confirmingPartial && !allDone && (
        <div className="badge badge-warn" style={{ display: "block", marginTop: 12 }}>
          {remainingAll} item{remainingAll === 1 ? "" : "s"} still unanswered.
          Submitting now records the checklist as it stands, and those items
          stay unanswered on the record.
        </div>
      )}

      {submitError && (
        <div className="badge badge-bad" style={{ display: "block", marginTop: 12 }}>
          {submitError}
        </div>
      )}

      {canAct && (
        <div className="row" style={{ marginTop: compact ? 10 : 16 }}>
          {sectionId && !allDone ? (
            // Working one section at a checkpoint: submitting is the whole
            // checklist's affair, so once this section's done point at it.
            remainingShown === 0 && shownItems.length > 0 ? (
              <button
                type="button"
                className="btn"
                onClick={() => navigate(`/checklists/${checklist.id}`)}
              >
                Section complete — {remainingAll} item
                {remainingAll === 1 ? "" : "s"} elsewhere
              </button>
            ) : null
          ) : (
            <>
            <button
              type="button"
              className={"btn " + (allDone ? "btn-primary" : "btn-danger")}
              disabled={submitting}
              onClick={() => {
                // Unfinished work is submittable — a round cut short by a
                // callout is still worth recording — but never by the same
                // tap that submits a finished one.
                if (!allDone && !confirmingPartial) {
                  setConfirmingPartial(true);
                  return;
                }
                void submit();
              }}
            >
              {submitting
                ? "Submitting…"
                : allDone
                  ? "Submit Checklist"
                  : confirmingPartial
                    ? `Submit anyway — ${remainingAll} unanswered`
                    : `Submit Checklist — ${remainingAll} item${remainingAll === 1 ? "" : "s"} remaining`}
            </button>
            {confirmingPartial && !allDone && !submitting && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => setConfirmingPartial(false)}
              >
                Keep working
              </button>
            )}
            </>
          )}
        </div>
      )}

    </div>
  );
}
