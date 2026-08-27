import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useActiveShift } from "../../data/shifts";
import { useCheckInsForUserSince } from "../../data/checkins";

/**
 * The current guard's checkpoint visits within their active shift — the single
 * fact both the tour list and the tour progress view derive "remaining" from. A
 * new shift starts every tour fresh; there is no separate reset action.
 *
 * Deliberately fetches all of the user's check-ins since shift start rather
 * than filtering to one tour's checkpoints: the checklist list needs progress
 * for *every* tour at once, and a shift's worth of one guard's check-ins is
 * small.
 */
export function useShiftVisits(): {
  activeShift: { id: string; started_at: string } | undefined;
  visitedIds: Set<string>;
} {
  const current = useCurrent();
  const userId = current.user?.id;

  const { shift } = useActiveShift(userId);
  // "" matches nothing, which is the right answer for a guard not on shift —
  // and keeps the query's shape stable so the hook order never changes.
  const { data: checkIns } = useCheckInsForUserSince(
    userId,
    shift?.started_at ?? "9999-12-31T00:00:00.000Z",
  );

  const visitedIds = new Set(
    checkIns
      .map((c) => c.checkpoint_id)
      .filter((cid): cid is string => Boolean(cid)),
  );

  return { activeShift: shift ?? undefined, visitedIds };
}
