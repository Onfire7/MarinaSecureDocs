// The end of a shift, as pure decisions (src/pages/checklists/
// ActiveChecklistPage.spec.md § Ending the shift; the template editor's rules
// are src/pages/admin/AdminChecklistTemplatesPage.spec.md § End Shift Items).
//
// Ending a shift always runs in one order, whichever button starts it: finish
// any of this shift's checklists still holding an unanswered End Shift Item,
// then the End of Shift Checklist if one is due, then any Fleet Vehicle still
// held, then the review, which alone ends the shift. The Shift card, the End Shift Item and the End of Shift
// Checklist's submit all ask nextEndOfShiftStep() where to go next.

/** One of the guard's checklists, as much as the next step needs of it. */
export interface ShiftChecklist {
  id: string;
  name: string;
  /** Null on rows made before created_at existed: never counted as this shift's. */
  created_at: string | number | null;
  status: string;
  /** Its End Shift Item, if it has one. */
  endShift: "unanswered" | "answered" | "none";
}

/** A Fleet Vehicle checkout the guard holds. */
export interface HeldVehicle {
  checkoutId: string;
  name: string;
  time_out: string | number;
  /** Set on a checkout opened by keeping the vehicle past an End of Shift. */
  kept_after_shift: number | boolean | null;
}

export type EndOfShiftStep =
  | { kind: "finish"; checklistId: string; name: string }
  | { kind: "end_of_shift_checklist"; existingId: string | null }
  | { kind: "vehicle"; checkoutId: string; name: string }
  | { kind: "review" };

/**
 * The vehicles End of Shift still has to ask about, earliest taken first. One
 * opened by keeping it during this Shift has been asked about already; one
 * kept from an earlier Shift has not.
 */
export function vehiclesToSettle(shiftStartedAt: string | number, held: HeldVehicle[]): HeldVehicle[] {
  const start = new Date(shiftStartedAt).getTime();
  return held
    .filter((v) => !(v.kept_after_shift && new Date(v.time_out).getTime() >= start))
    .sort((a, b) => new Date(a.time_out).getTime() - new Date(b.time_out).getTime());
}

export function nextEndOfShiftStep(input: {
  shiftStartedAt: string | number;
  checklists: ShiftChecklist[];
  /** The guard's Role has a Clock Out template with something to do right now. */
  clockOutTemplateReady: boolean;
  /** shifts.end_of_shift_checklist_id, resolved. */
  endOfShiftChecklist: { id: string; status: string } | null;
  /** A checklist just submitted, whose new status may not have arrived yet. */
  excludeChecklistId?: string;
  /** Fleet Vehicles the guard holds. */
  heldVehicles?: HeldVehicle[];
}): EndOfShiftStep {
  const start = new Date(input.shiftStartedAt).getTime();
  const finish = input.checklists
    .filter(
      (c) =>
        c.id !== input.excludeChecklistId &&
        c.status !== "complete" &&
        c.endShift === "unanswered" &&
        c.created_at != null &&
        new Date(c.created_at).getTime() >= start,
    )
    .sort((a, b) => new Date(a.created_at!).getTime() - new Date(b.created_at!).getTime())[0];
  if (finish) return { kind: "finish", checklistId: finish.id, name: finish.name };

  const eos = input.endOfShiftChecklist;
  if (eos && eos.id !== input.excludeChecklistId && eos.status !== "complete") {
    return { kind: "end_of_shift_checklist", existingId: eos.id };
  }
  if (!eos && input.clockOutTemplateReady) {
    return { kind: "end_of_shift_checklist", existingId: null };
  }
  const vehicle = vehiclesToSettle(input.shiftStartedAt, input.heldVehicles ?? [])[0];
  if (vehicle) return { kind: "vehicle", checkoutId: vehicle.checkoutId, name: vehicle.name };
  return { kind: "review" };
}

// ---- The template editor's rules

export interface TemplateShape {
  trigger_type: string;
  /** In position order. */
  sections: {
    id: string;
    trigger_type: string;
    is_active: number | boolean;
    items: { type: string }[];
  }[];
}

const hasEndShift = (t: TemplateShape) =>
  t.sections.some((s) => s.items.some((i) => i.type === "end_shift"));

/** Why End Shift can't go somewhere: a key under admin:checklistTemplates.endShiftBlocked. */
export type EndShiftBlock = "alreadyHas" | "clockOut" | "notLastSection" | "sectionOff" | "notAlways";

/**
 * Why End Shift can't be added to this section of this template, or null when
 * it can. The editor hides the option for the first two reasons and shows it
 * disabled, with the reason, for the rest. A key, not a sentence, so this
 * stays pure and the page says it in the user's language.
 */
export function endShiftBlockedReason(t: TemplateShape, sectionId: string): EndShiftBlock | null {
  if (hasEndShift(t)) return "alreadyHas";
  if (t.trigger_type === "clock_out") return "clockOut";
  const last = t.sections[t.sections.length - 1];
  if (!last || last.id !== sectionId) return "notLastSection";
  if (!last.is_active) return "sectionOff";
  if (last.trigger_type !== "manual") return "notAlways";
  return null;
}

/** True when the add-item menu should not list End Shift at all. */
export function endShiftHidden(t: TemplateShape): boolean {
  return hasEndShift(t) || t.trigger_type === "clock_out";
}

/** Why this template can't become a Clock Out template (a key, as above), or null when it can. */
export function clockOutBlockedReason(t: TemplateShape): "hasEndShift" | null {
  return hasEndShift(t) ? "hasEndShift" : null;
}

/**
 * An order with the pinned row moved to the end and everything else in the
 * order given: what any reorder or append writes, so the End Shift Item (and
 * the section holding it) stays last whatever was dropped where.
 */
export function pinEndShiftLast<T>(rows: T[], isPinned: (row: T) => boolean): T[] {
  return [...rows.filter((r) => !isPinned(r)), ...rows.filter(isPinned)];
}
