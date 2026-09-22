import { useQuery } from "@powersync/react";
import { db, stamp } from "../lib/db";
import { insert, transact, update } from "./sql";
import { recordActivity } from "./activity";

// Shifts — when a guard was on duty.
//
// A shift has a guard, a start, an end, and (once the reporting layer exists)
// the moment its report went out. It has no checklist of its own: the
// end-of-shift checklist points back at the shift, not the other way round,
// because a shift can end without one.

export interface ShiftRow {
  id: string;
  guard_id: string;
  started_at: string;
  ended_at: string | null;
  report_sent_at: string | null;
  end_of_shift_checklist_id: string | null;
  guard_name: string | null;
}

const SHIFT_SELECT = `
  SELECT s.*, u.name AS guard_name
    FROM shifts s
    LEFT JOIN users u ON u.id = s.guard_id`;

export function useShifts(limit = 50) {
  return useQuery<ShiftRow>(
    `${SHIFT_SELECT} ORDER BY s.started_at DESC LIMIT ?`,
    [limit],
  );
}

export function useShift(shiftId: string | undefined) {
  const { data, isLoading } = useQuery<ShiftRow>(`${SHIFT_SELECT} WHERE s.id = ?`, [
    shiftId ?? "",
  ]);
  return { shift: data[0] ?? null, isLoading };
}

/** The signed-in guard's open shift, if they are on one. */
export function useActiveShift(userId: string | undefined) {
  const { data, isLoading } = useQuery<ShiftRow>(
    `${SHIFT_SELECT} WHERE s.guard_id = ? AND s.ended_at IS NULL
      ORDER BY s.started_at DESC LIMIT 1`,
    [userId ?? ""],
  );
  return { shift: data[0] ?? null, isLoading };
}

export async function startShift(
  user: { id: string; name: string },
): Promise<string> {
  return transact(async (tx) => {
    const shiftId = await insert(tx, "shifts", {
      guard_id: user.id,
      started_at: stamp(),
    });
    await recordActivity(tx, {
      eventType: "shift.started",
      summary: `Shift started by ${user.name}`,
      subjectType: "shifts",
      subjectId: shiftId,
      actorId: user.id,
    });
    return shiftId;
  });
}

export async function endShift(
  shiftId: string,
  user: { id: string; name: string },
  endOfShiftChecklistId?: string | null,
): Promise<void> {
  await transact(async (tx) => {
    await update(tx, "shifts", shiftId, {
      ended_at: stamp(),
      end_of_shift_checklist_id: endOfShiftChecklistId ?? undefined,
    });
    await recordActivity(tx, {
      eventType: "shift.ended",
      summary: `Shift ended by ${user.name}`,
      subjectType: "shifts",
      subjectId: shiftId,
      actorId: user.id,
    });
  });
}

/** Link an end-of-shift checklist to the shift it closes. */
export function attachEndOfShiftChecklist(
  shiftId: string,
  checklistId: string,
): Promise<void> {
  return update(db, "shifts", shiftId, {
    end_of_shift_checklist_id: checklistId,
  });
}
