import { useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { ActiveChecklistPage } from "./ActiveChecklistPage";
import { ChecklistDetailPage } from "./ChecklistDetailPage";

// A Checklist's own status decides which screen opens it — Not Started /
// In Progress goes to the interactive Active Checklist, Complete goes to the
// read-only Checklist Detail (see pages/checklist-list.html — Actions).
export function ChecklistRoute() {
  const { id } = useParams();
  const { data } = db.useQuery(id ? { checklists: { $: { where: { id } } } } : null);
  const status = data?.checklists?.[0]?.status;

  if (!status) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }
  return status === "complete" ? <ChecklistDetailPage /> : <ActiveChecklistPage />;
}
