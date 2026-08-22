import { useLocation, useNavigate } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";

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

  const { data } = db.useQuery(
    canCalls || canSms
      ? {
          calls: { $: { where: { missed: true } } },
          smsThreads: { $: { where: { unread: true } } },
        }
      : null,
  );

  if (!canCalls && !canSms) return null;

  const count =
    (canCalls ? (data?.calls?.length ?? 0) : 0) +
    (canSms ? (data?.smsThreads?.length ?? 0) : 0);

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
