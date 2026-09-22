import { useLocation, useNavigate } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useMissedCalls, useSmsThreads } from "../../data/comms";

// The floating Missed Comms Badge (see docs/pages/dashboard.html and
// missed-comms-detail.html): an always-visible count of missed calls plus
// unread SMS that opens the combined catch-up worklist.
//
// The count sums only what this user can actually see, so with neither
// view_calls nor view_sms it has nothing to show and doesn't appear at all.
export function MissedCommsBadge() {
  const current = useCurrent();
  const navigate = useNavigate();
  const location = useLocation();
  const canCalls = current.can("view_calls");
  const canSms = current.can("view_sms");

  // Both queries run regardless of permission, and both come back empty
  // without it: the rows were never synced to this device. The `can` checks
  // below are about not rendering a zero badge, not about hiding data.
  const { data: missedCalls } = useMissedCalls();
  const { data: threads } = useSmsThreads();

  if (!canCalls && !canSms) return null;

  const count =
    (canCalls ? missedCalls.length : 0) +
    (canSms ? threads.filter((t) => t.unread === 1).length : 0);

  // Nothing outstanding, or already looking at the worklist.
  if (count === 0 || location.pathname === "/comms/missed") return null;

  return (
    <button
      type="button"
      className="missed-badge"
      onClick={() => navigate("/comms/missed")}
      title="Missed calls and unread texts"
    >
      <span className="missed-badge-count">{count}</span>
      missed
    </button>
  );
}
