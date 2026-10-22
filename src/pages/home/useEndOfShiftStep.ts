import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { createInstanceFromTemplate } from "../../data/checklists";
import { attachEndOfShiftChecklist } from "../../data/shifts";
import type { EndOfShiftState } from "../../data/endOfShift";
import type { EndOfShiftStep } from "../../lib/endOfShift";

// Taking the next step of ending a shift (src/pages/checklists/
// ActiveChecklistPage.spec.md § Ending the shift). The Shift card and the End
// Shift Item both go through here, so the two can't disagree about the order.

/** The Shift card's button label for a step, in the home namespace. */
export function useEndOfShiftLabel(step: EndOfShiftStep | null): string {
  const { t } = useTranslation("home");
  if (!step) return "";
  switch (step.kind) {
    case "finish":
      return t("endOfShift.finish", { name: step.name });
    case "end_of_shift_checklist":
      return t("endOfShift.checklistStep");
    case "vehicle":
    case "review":
      return t("endOfShift.reportStep");
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
          reason: { kind: "clockOut" },
        });
        await attachEndOfShiftChecklist(shift.id, checklistId);
      }
      navigate(`/checklists/${checklistId}`);
      return;
    }
    navigate("/shift/end");
  };
}
