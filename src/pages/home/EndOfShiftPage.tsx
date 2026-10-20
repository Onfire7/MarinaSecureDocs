import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { formatDuration, shiftWindowMs } from "../../lib/shiftReport";
import { endShift } from "../../data/shifts";
import { useEndOfShift, useOpenShiftChecklists } from "../../data/endOfShift";

// The End of Shift review, /shift/end (ActiveChecklistPage.spec.md § Ending
// the shift). The only place a shift ends. Until the Shift Report is built it
// is a plain confirmation: the shift, any of its checklists still open, and
// End Shift and Submit. The report will take this page's place, with the same
// button at its end.
export function EndOfShiftPage() {
  const current = useCurrent();
  const navigate = useNavigate();
  const userId = current.user?.id;
  const { shift } = useEndOfShift(userId);
  const open = useOpenShiftChecklists(userId, shift?.started_at);
  const [ending, setEnding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!shift) {
    return (
      <div className="placeholder">
        <div className="big">You're not on shift</div>
        <Link to="/">Back to the dashboard</Link>
      </div>
    );
  }

  const submit = async () => {
    if (!current.user) return;
    setEnding(true);
    setError(null);
    try {
      await endShift(shift.id, { id: current.user.id, name: current.user.name });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't end the shift.");
      setEnding(false);
    }
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">End of Shift</h1>
          <div className="page-sub">
            Started{" "}
            {new Date(shift.started_at).toLocaleString(undefined, {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            · {formatDuration(shiftWindowMs(shift))} so far
          </div>
        </div>
      </div>

      {open.length > 0 && (
        <div className="card" data-testid="end-of-shift-open" style={{ marginBottom: 14 }}>
          <div className="card-title">
            {open.length === 1
              ? "1 checklist is still open"
              : `${open.length} checklists are still open`}
          </div>
          <div className="card-meta" style={{ marginBottom: 8 }}>
            Anything recorded on {open.length === 1 ? "it" : "them"} won't be saved
            unless {open.length === 1 ? "it's" : "they're"} submitted.
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {open.map((c) => (
              <Link key={c.id} to={`/checklists/${c.id}`}>
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="badge badge-bad" style={{ display: "block", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        disabled={ending}
        onClick={() => void submit()}
      >
        {ending ? "Ending…" : "End Shift and Submit"}
      </button>
    </div>
  );
}
