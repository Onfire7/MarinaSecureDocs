import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";

/**
 * The current guard's checkpoint visits within their active shift — the
 * single fact both the tour list and the tour progress view derive
 * "remaining" from. A new shift starts every tour fresh; there is no
 * separate reset action.
 *
 * Deliberately fetches all of the user's check-ins since shift start rather
 * than filtering to one tour's checkpoints: the checklist list needs
 * progress for *every* tour at once, and a shift's worth of one guard's
 * check-ins is small.
 */
export function useShiftVisits(): {
  activeShift: { id: string; startedAt: string | number } | undefined;
  visitedIds: Set<string>;
} {
  const current = useCurrent();
  const userId = current.user?.id;

  const { data: shiftData } = db.useQuery(
    userId
      ? { shifts: { $: { where: { "guard.id": userId, endedAt: { $isNull: true } } } } }
      : null,
  );
  const activeShift = shiftData?.shifts?.[0];

  const { data: checkInData } = db.useQuery(
    userId && activeShift
      ? {
          checkIns: {
            $: {
              where: {
                "user.id": userId,
                timestamp: { $gt: new Date(activeShift.startedAt) },
              },
            },
            // Filtering on a link does not load it — without this the rows
            // come back with no checkpoint and nothing ever reads as visited.
            checkpoint: {},
          },
        }
      : null,
  );

  const visitedIds = new Set(
    (checkInData?.checkIns ?? [])
      .map((c) => c.checkpoint?.id)
      .filter((cid): cid is string => Boolean(cid)),
  );

  return { activeShift, visitedIds };
}
