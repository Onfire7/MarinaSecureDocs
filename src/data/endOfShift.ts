import { useQuery } from "@powersync/react";
import { useActiveShift } from "./shifts";
import { hasWorkAtCreation, useInstantiableTemplates } from "./checklists";
import { useRoleIdsFor } from "./users";
import { nextEndOfShiftStep, type EndOfShiftStep, type ShiftChecklist } from "../lib/endOfShift";
import type { InstantiableTemplate } from "../lib/checklists";
import type { ShiftRow } from "./shifts";

// What the end of a guard's shift needs to read (src/pages/checklists/
// ActiveChecklistPage.spec.md § Ending the shift). The decision itself is
// src/lib/endOfShift.ts; this gathers its inputs.

/**
 * The guard's own open, top-level checklists, each with the state of its End
 * Shift Item. An item is answered once it has a completed_at, which the End
 * Shift Item writes as it submits.
 */
function useOpenChecklistsOf(userId: string | undefined) {
  return useQuery<ShiftChecklist>(
    `SELECT i.id, COALESCE(t.name, 'Checklist') AS name, i.created_at, i.status,
            (SELECT CASE
                      WHEN COUNT(*) = 0 THEN 'none'
                      WHEN SUM(CASE WHEN ii.completed_at IS NULL THEN 1 ELSE 0 END) > 0 THEN 'unanswered'
                      ELSE 'answered'
                    END
               FROM checklist_instance_items ii
               JOIN checklist_instance_sections s ON s.id = ii.section_id
               JOIN checklist_template_items ti ON ti.id = ii.template_item_id
              WHERE s.instance_id = i.id AND ti.type = 'end_shift') AS endShift
       FROM checklist_instances i
       LEFT JOIN checklist_templates t ON t.id = i.template_id
      WHERE i.assigned_to_id = ? AND i.parent_item_id IS NULL AND i.status <> 'complete'
      ORDER BY i.created_at`,
    [userId ?? ""],
  );
}

/** The guard's open checklists created during this shift — what the review warns about. */
export function useOpenShiftChecklists(
  userId: string | undefined,
  shiftStartedAt: string | undefined,
): ShiftChecklist[] {
  const { data } = useOpenChecklistsOf(userId);
  if (!shiftStartedAt) return [];
  const start = new Date(shiftStartedAt).getTime();
  return data.filter((c) => c.created_at != null && new Date(c.created_at).getTime() >= start);
}

export interface EndOfShiftState {
  shift: ShiftRow | null;
  step: EndOfShiftStep | null;
  /** The Clock Out template the End of Shift Checklist would be made from. */
  clockOutTemplate: InstantiableTemplate | undefined;
}

/**
 * Where ending the shift goes next, for the signed-in guard. Null while there
 * is no active shift. `excludeChecklistId` names a checklist just submitted
 * whose new status this device may not have read back yet.
 */
export function useEndOfShift(
  userId: string | undefined,
  excludeChecklistId?: string,
): EndOfShiftState {
  const { shift } = useActiveShift(userId);
  const roleIds = useRoleIdsFor(userId);
  const clockOut = useInstantiableTemplates(["clock_out"]);
  const { data: checklists } = useOpenChecklistsOf(userId);
  const { data: eosRows } = useQuery<{ id: string; status: string }>(
    "SELECT id, status FROM checklist_instances WHERE id = ?",
    [shift?.end_of_shift_checklist_id ?? ""],
  );

  // Clock templates are role-scoped like everything else; one with nothing
  // switched on right now generates nothing, so it isn't due.
  const clockOutTemplate = clockOut.find(
    (t) => t.assigned_role_id && roleIds.includes(t.assigned_role_id) && hasWorkAtCreation(t),
  );
  if (!shift) return { shift: null, step: null, clockOutTemplate };
  const step = nextEndOfShiftStep({
    shiftStartedAt: shift.started_at,
    checklists,
    clockOutTemplateReady: !!clockOutTemplate,
    // Linked but not yet synced reads as linked and unfinished: the guard
    // made it on this device moments ago.
    endOfShiftChecklist: shift.end_of_shift_checklist_id
      ? (eosRows[0] ?? { id: shift.end_of_shift_checklist_id, status: "in_progress" })
      : null,
    excludeChecklistId,
  });
  return { shift, step, clockOutTemplate };
}
