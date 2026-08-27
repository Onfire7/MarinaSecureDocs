import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { statusLabel } from "../../lib/locations";
import { formatDuration, shiftWindowMs, withinWindow } from "../../lib/shiftReport";
import { useShift } from "../../data/shifts";
import { useCheckInsInWindow } from "../../data/checkins";
import { useInstances } from "../../data/checklists";
import { useIncidents } from "../../data/incidents";
import { useTickets } from "../../data/tickets";

// Reports — Shift Report (see docs/pages/shift-report.html).
// Content is compiled live from current data every time it's viewed, so it
// can legitimately show more than the original email contained — a resend
// captures this current state, not the original snapshot.
export function ShiftReportPage() {
  const { id: shiftId } = useParams();
  const current = useCurrent();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const { shift } = useShift(shiftId);

  // Association is by timestamp, not reference — and scoped to this guard where
  // the record carries a person. The window runs to "now" for an open shift, so
  // viewing mid-shift shows progress so far.
  const bounds = shift
    ? shiftWindowMs(shift)
    : { start: 0, end: 0 };
  const { data: checkIns } = useCheckInsInWindow(
    shift?.guard_id,
    new Date(bounds.start).toISOString(),
    new Date(bounds.end).toISOString(),
  );
  const { data: allChecklists } = useInstances();
  const { data: allIncidents } = useIncidents();
  const { data: allTickets } = useTickets();

  if (!shift) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const window = shiftWindowMs(shift);
  const isOwnShift = shift.guard_id === current.user?.id;
  const canResend = isOwnShift || current.can("view_reports");

  const guardId = shift.guard_id;
  const checklists = allChecklists.filter(
    (c) =>
      withinWindow(c.completed_at ?? c.started_at, window) &&
      (!c.assigned_to_id || c.assigned_to_id === guardId),
  );
  const incidents = allIncidents.filter((i) => withinWindow(i.created_at, window));
  const tickets = allTickets.filter((t) => withinWindow(t.created_at, window));

  const resend = async () => {
    setSending(true);
    setSendError(null);
    try {
      // The send path is a Netlify Function that compiles fresh and hands off
      // to the Twilio Function for SendGrid delivery. Until that layer is
      // deployed this returns 404 — surfaced rather than silently swallowed.
      const res = await fetch(`/api/reports/shift/${shift.id}/send`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Send failed (${res.status})`);
    } catch (err) {
      setSendError(
        err instanceof Error
          ? `${err.message} — the shift-report function isn't deployed yet.`
          : "Send failed.",
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            Shift report — {shift.guard_name ?? "Unassigned"}
          </h1>
          <div className="page-sub">
            {new Date(shift.started_at).toLocaleString()} ·{" "}
            {shift.ended_at ? formatDuration(window) : "in progress"}
          </div>
        </div>
        <div className="row">
          <span className={shift.report_sent_at ? "badge badge-good" : "badge badge-warn"}>
            {shift.report_sent_at
              ? `Sent ${new Date(shift.report_sent_at).toLocaleString()}`
              : "Not sent yet"}
          </span>
          {canResend && (
            <button
              type="button"
              className="btn btn-sm"
              disabled={sending || !navigator.onLine}
              title={
                navigator.onLine
                  ? "Recompiles from current data and emails the distribution list"
                  : "Sending requires connectivity"
              }
              onClick={() => void resend()}
            >
              {sending ? "Sending…" : "Resend"}
            </button>
          )}
        </div>
      </div>

      {sendError && (
        <div className="badge badge-bad" style={{ display: "block", marginBottom: 12 }}>
          {sendError}
        </div>
      )}

      <div className="grid-2">
        <div className="stack">
          <Section title={`Check-ins (${checkIns.length})`}>
            {checkIns.map((c) => (
              <div key={c.id} className="card spread">
                <span>
                  {/* A check-in outlives the checkpoint it was made at —
                      check_ins.checkpoint_id is ON DELETE SET NULL — so a
                      missing name means retired, not broken. */}
                  {c.checkpoint_name ?? "Removed checkpoint"}
                </span>
                <span className="muted small">
                  {c.method === "manual" ? "Manual" : "Scanned"}
                  {c.within_radius === 0 && " · outside radius"} ·{" "}
                  {new Date(c.timestamp).toLocaleTimeString(undefined, {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </Section>

          <Section title={`Checklists (${checklists.length})`}>
            {checklists.map((c) => (
              <Link
                key={c.id}
                to={`/checklists/${c.id}`}
                className="card spread"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <span>{c.template_name ?? "Checklist"}</span>
                <span className="badge">{statusLabel(c.status)}</span>
              </Link>
            ))}
          </Section>
        </div>

        <div className="stack">
          {current.can("view_incidents") && (
            <Section title={`Incidents (${incidents.length})`}>
              {incidents.map((i) => (
                <Link
                  key={i.id}
                  to={`/incidents/${i.id}`}
                  className="card spread"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <span>{i.title}</span>
                  <span className="badge">{i.status_name}</span>
                </Link>
              ))}
            </Section>
          )}

          <Section title={`Tickets raised (${tickets.length})`}>
            {tickets.map((t) => (
              <Link
                key={t.id}
                to={`/tickets/${t.id}`}
                className="card spread"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <span>{t.title}</span>
                <span className="badge">{statusLabel(t.priority)}</span>
              </Link>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const empty = Array.isArray(children) && children.length === 0;
  return (
    <div>
      <div className="section-title">{title}</div>
      <div className="stack" style={{ gap: 6 }}>
        {empty ? <span className="muted small">None during this shift.</span> : children}
      </div>
    </div>
  );
}
