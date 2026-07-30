import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { statusLabel } from "../../lib/locations";
import { formatDuration, shiftWindowMs, withinWindow } from "../../lib/shiftReport";

// Reports — Shift Report (see docs/pages/shift-report.html).
// Content is compiled live from current data every time it's viewed, so it
// can legitimately show more than the original email contained — a resend
// captures this current state, not the original snapshot.
export function ShiftReportPage() {
  const { id: shiftId } = useParams();
  const current = useCurrent();
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const { data } = db.useQuery(
    shiftId
      ? {
          shifts: { $: { where: { id: shiftId } }, guard: {} },
          // The checkpoint's location comes along so the log can say where
          // each check-in happened without the name having to carry it.
          checkIns: { checkpoint: { location: {} }, user: {} },
          checklists: { template: {}, assignedTo: {} },
          incidents: { author: {} },
          tickets: { createdBy: {} },
        }
      : null,
  );
  const shift = data?.shifts?.[0];

  if (!shift) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const window = shiftWindowMs(shift);
  const isOwnShift = shift.guard?.id === current.user?.id;
  const canResend = isOwnShift || current.can("view_reports");

  // Association is by timestamp, not reference — and scoped to this guard
  // where the record carries a person.
  const guardId = shift.guard?.id;
  const checkIns = (data?.checkIns ?? []).filter(
    (c) => withinWindow(c.timestamp, window) && (!guardId || c.user?.id === guardId),
  );
  const checklists = (data?.checklists ?? []).filter(
    (c) =>
      withinWindow(c.completedAt ?? c.startedAt, window) &&
      (!guardId || !c.assignedTo || c.assignedTo.id === guardId),
  );
  const incidents = (data?.incidents ?? []).filter((i) =>
    withinWindow(i.createdAt, window),
  );
  const tickets = (data?.tickets ?? []).filter((t) => withinWindow(t.createdAt, window));

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
            Shift report — {shift.guard?.name ?? "Unassigned"}
          </h1>
          <div className="page-sub">
            {new Date(shift.startedAt).toLocaleString()} ·{" "}
            {shift.endedAt ? formatDuration(window) : "in progress"}
          </div>
        </div>
        <div className="row">
          <span className={shift.reportSentAt ? "badge badge-good" : "badge badge-warn"}>
            {shift.reportSentAt
              ? `Sent ${new Date(shift.reportSentAt).toLocaleString()}`
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
                  {c.checkpoint?.name ?? "Unknown checkpoint"}
                  {c.checkpoint?.location?.name && (
                    <span className="muted"> · {c.checkpoint.location.name}</span>
                  )}
                </span>
                <span className="muted small">
                  {c.method === "manual" ? "Manual" : "Scanned"}
                  {c.withinRadius === false && " · outside radius"} ·{" "}
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
                <span>{c.template?.name ?? "Checklist"}</span>
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
                  <span className="badge">{statusLabel(i.status)}</span>
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
