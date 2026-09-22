import { useRef, useState } from "react";
import { useEffect } from "react";
import type { ComponentType, ReactNode } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import {
  isStateCheck,
  isVisibleNow,
  normalizeItemType,
  type DoorCheckConfig,
  type ItemType,
} from "../../lib/checklists";
import { ReorderableList } from "../shared/ReorderableList";
import {
  checkMaintenance,
  collectPendingEffects,
} from "../../data/checklistSubmit";
import {
  itemConfig,
  itemResult,
  reorderInstanceItems,
  startAndClaimInstance,
  submitInstance,
  useInstance,
  useInstanceItems,
  useInstanceSections,
  useShiftEndedBy,
} from "../../data/checklists";
import { useIncidentStatuses, useTicketStatuses } from "../../data/lookups";
import { useLocations } from "../../data/locations";
import { useRoleIdsFor } from "../../data/users";
import { useInstances } from "../../data/checklists";
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
// Item-by-item completion of an in-progress instance; every write here goes to
// the device's own database, so it works fully offline. An instance is fully
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

  const { instance: checklist } = useInstance(checklistId);
  const { data: sectionRows } = useInstanceSections(checklistId);
  const { data: itemRows } = useInstanceItems(checklistId);
  const endedShift = useShiftEndedBy(checklistId);
  const roleIds = useRoleIdsFor(current.user?.id);
  const { data: allLocations } = useLocations();
  const { data: allInstances } = useInstances();
  const { statuses: incidentStatuses } = useIncidentStatuses();
  const { statuses: ticketStatuses } = useTicketStatuses();

  // Who may work this checklist: its assignee, any holder of the template's
  // assignedRole, or anyone at all if the template somehow has no role (the
  // orphan guard). viewerRoles members and other onlookers get a read-only
  // rendering — client-side only until the permissions overhaul.
  const userId = current.user?.id;
  const canAct = Boolean(
    checklist &&
      userId &&
      (checklist.assigned_to_id === userId ||
        !checklist.assigned_role_id ||
        roleIds.includes(checklist.assigned_role_id)),
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
    const needsClaim = !checklist.assigned_to_id && Boolean(userId);
    if (!needsStart && !needsClaim) return;
    started.current = checklist.id;
    void startAndClaimInstance(
      checklist.id,
      checklist.template_name ?? "Checklist",
      { start: needsStart, claim: needsClaim },
      userId!,
    );
  }, [checklist, userId, canAct, sectionId]);

  // Both lists arrive ordered from their own queries. Sections still inside
  // their hide_until exist but aren't anyone's work yet — their items still
  // count toward "remaining" below, because a checklist can't be submitted
  // before a section has even revealed itself.
  const allSections = sectionRows;
  const hiddenSections = allSections.filter((s) => !isVisibleNow(s));
  const visibleSections = allSections
    .filter((s) => isVisibleNow(s))
    .filter((s) => (sectionId ? s.id === sectionId : true))
    .map((s) => ({
      ...s,
      items: itemRows.filter((i) => i.section_id === s.id),
    }));

  const allItems = itemRows;

  type ItemRow = (typeof allItems)[number];
  // A location check spawns a whole sub-checklist; it counts as done only when
  // that sub-checklist is, which is why every instance is in scope here.
  const nestedStatusById = new Map(allInstances.map((c) => [c.id, c.status]));

  const itemLocationId = (item: ItemRow): string | undefined =>
    isStateCheck(item.type)
      ? (itemConfig(item) as DoorCheckConfig | undefined)?.locationId
      : undefined;

  // A door/lock check away from its section's own location gets a small
  // header naming where it is — "Front Door" at one building shouldn't read
  // as the same card as "Front Door" at another. A section without a
  // location has no baseline, so every bound location headers there.
  const offSiteLocationNameById = new Map(allLocations.map((l) => [l.id, l.name]));

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
          <div className="card-title">{checklist.template_name ?? "Checklist"}</div>
          <div className="card-meta">Complete</div>
        </div>
      );
    }
    onComplete?.();
    return null;
  }

  const isDone = (item: ItemRow) => {
    if (item.result == null) return false;
    if (item.type === "location_check") {
      const nestedId = (itemResult(item) as { nestedChecklistId?: string } | null)
        ?.nestedChecklistId;
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
    const templateName = checklist.template_name ?? "Checklist";
    // Everything the items described while the guard worked — incidents,
    // tickets, meter readings — is written in the same transaction that
    // completes the checklist. Until this point an item could still be reopened
    // and changed, which is only safe because none of it existed.
    const collected = collectPendingEffects(
      allItems.map((i) => ({ id: i.id, result: itemResult(i) })),
    );
    // Maintenance is evaluated BEFORE the transaction opens, against live
    // history, so a rule someone else already ticketed is not ticketed twice.
    const maintenance = await checkMaintenance(collected);
    await submitInstance({
      instanceId: checklist.id,
      templateName,
      parentItemId: checklist.parent_item_id,
      endedShift: endedShift
        ? { id: endedShift.id, guardName: current.user?.name ?? "a guard" }
        : null,
      collected,
      maintenance,
      statusIds: {
        incidentOpen: incidentStatuses.find((st) => st.is_terminal === 0)?.id ?? null,
        ticketOpen: ticketStatuses.find((st) => st.is_terminal === 0)?.id ?? null,
      },
      actorId: current.user?.id ?? null,
    });
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
  const reorderItems = (orderedIds: string[]) => void reorderInstanceItems(orderedIds);

  const title = checklist.template_name ?? "Checklist";
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
                {checklist.due_by && ` · due ${dueText(checklist.due_by)}`}
              </div>
            )}
          </div>
        </div>
      )}

      {!canAct && (
        <p className="muted small" style={{ marginTop: 4 }}>
          Read-only — this checklist belongs to another role.
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
                      {showSectionHeadings && section.due_by && (
                        <span className="muted small">
                          {" "}
                          · due {dueText(section.due_by)}
                        </span>
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
            let previousLocationId = section.location_id ?? undefined;
            // A location heading breaks the flow, so items are collected into
            // runs between headings — dragging is only meaningful within one.
            const runs: { items: typeof section.items }[] = [{ items: [] }];
            for (const item of section.items) {
              const locationId = itemLocationId(item) ?? section.location_id ?? undefined;
              if (
                locationId !== (section.location_id ?? undefined) &&
                locationId !== previousLocationId
              ) {
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
                      const Component = componentFor(item.type);
                      return (
                        <Component
                          item={item}
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
            ? `1 more section unlocks at ${dueText(hiddenSections[0].hide_until) ?? "a later time"}.`
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
