import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { DEFAULT_POST_RETURN_STATUS } from "../../lib/assets";
import { boardOrder } from "../../lib/fleet";
import {
  fleetItemMode,
  returnAnswer,
  takeAnswer,
  type FleetAnswer,
  type FleetVehicleConfig,
  type FleetVehicleResult,
  type HeldCheckout,
  type ShiftCheckIn,
} from "../../lib/fleetItem";
import {
  useCheckInsSince,
  useFleetPeople,
  useFleetVehicles,
  type FleetContext,
  type FleetPersonRow,
  type FleetVehicleRow,
} from "../../data/fleet";
import { itemConfig, itemResult, type InstanceItemRow } from "../../data/checklists";
import { resolveStatusByName, useAssetStatuses, useTicketStatuses } from "../../data/lookups";
import { useActiveShift } from "../../data/shifts";

// What every Fleet Vehicle Item on a checklist reads, gathered once by the
// panel (ActiveChecklistPage.spec.md § Fleet Vehicle Item): the board, what
// the guard holds, what they returned this Shift, and how each item reads as
// answered — which the panel also needs, to count what is left.

export interface FleetItems {
  vehicles: FleetVehicleRow[];
  people: FleetPersonRow[];
  myContact: string | null;
  held: HeldCheckout[];
  checkIns: ShiftCheckIn[];
  ctx: FleetContext;
  /** Where a vehicle lands on return: its own post-return status, else "Available". */
  postReturn(v: FleetVehicleRow): { id: string; name: string } | null;
  /** How a Fleet Vehicle Item reads now; null is unanswered. */
  answer(item: InstanceItemRow): FleetAnswer;
}

export function useFleetItems(): FleetItems {
  const current = useCurrent();
  const { data: rows } = useFleetVehicles();
  const { data: people } = useFleetPeople();
  const { statuses } = useAssetStatuses();
  const { statuses: ticketStatuses } = useTicketStatuses();
  const { shift } = useActiveShift(current.user?.id);
  const myContact = current.user?.contact_id ?? null;
  const { data: checkIns } = useCheckInsSince(myContact, shift?.started_at);

  const vehicles = boardOrder(rows, myContact);
  const held: HeldCheckout[] = myContact
    ? rows
        .filter((v) => v.checkout_id && v.checkout_person_id === myContact)
        .map((v) => ({
          id: v.checkout_id!,
          asset_id: v.id,
          time_out: v.checked_out_at!,
          kept_after_shift: v.checkout_kept,
        }))
    : [];

  return {
    vehicles,
    people,
    myContact,
    held,
    checkIns,
    ctx: {
      ticketStatusId: ticketStatuses.find((s) => s.is_terminal === 0)?.id ?? null,
      actorId: current.user?.id ?? null,
    },
    postReturn: (v) =>
      statuses.find((s) => s.id === v.post_return_status_id) ??
      resolveStatusByName(statuses, DEFAULT_POST_RETURN_STATUS),
    answer: (item) => {
      const saved = itemResult(item) as FleetVehicleResult | null;
      switch (fleetItemMode(itemConfig(item) as FleetVehicleConfig)) {
        case "take":
          return takeAnswer(saved, held);
        case "return":
          return returnAnswer(saved, held, checkIns);
        case "status":
          return saved ? { source: "saved", result: saved } : null;
      }
    },
  };
}
