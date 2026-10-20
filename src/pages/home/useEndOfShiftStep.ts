import { useNavigate } from "react-router-dom";
import { id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { createInstanceFromTemplate } from "../../data/checklists";
import { attachEndOfShiftChecklist } from "../../data/shifts";
import type { EndOfShiftState } from "../../data/endOfShift";
import type { EndOfShiftStep } from "../../lib/endOfShift";

// Taking the next step of ending a shift (src/pages/checklists/
// ActiveChecklistPage.spec.md § Ending the shift). The Shift card and the End
// Shift Item both go through here, so the two can't disagree about the order.

export function endOfShiftLabel(step: EndOfShiftStep): string {
  switch (step.kind) {
    case "finish":
      return `Finish ${step.name}`;
    case "end_of_shift_checklist":
      return "End of Shift Checklist";
    case "review":
      return "End of Shift Report";
  }
}

export function useGoToEndOfShiftStep() {
  const navigate = useNavigate();
  const current = useCurrent();
  return async ({ shift, step, clockOutTemplate }: EndOfShiftState) => {
    if (!shift || !step) return;
    if (step.kind === "finish") {
      navigate(`/checklists/${step.checklistId}#end-shift`);
      return;
    }
    if (step.kind === "end_of_shift_checklist") {
      let checklistId = step.existingId;
      if (!checklistId) {
        // Due a moment ago but gone now (the template was edited): nothing to
        // make, so the next step is the review.
        if (!clockOutTemplate || !current.user) {
          navigate("/shift/end");
          return;
        }
        checklistId = id();
        await createInstanceFromTemplate({
          template: clockOutTemplate,
          userId: current.user.id,
          instanceId: checklistId,
          reason: "clock-out",
        });
        await attachEndOfShiftChecklist(shift.id, checklistId);
      }
      navigate(`/checklists/${checklistId}`);
      return;
    }
    navigate("/shift/end");
  };
}
