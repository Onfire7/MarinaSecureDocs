import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useShifts } from "../../data/shifts";
import { useIncidents } from "../../data/incidents";
import { useTickets } from "../../data/tickets";
import { useCalls, useSmsThreads } from "../../data/comms";

// Reports — Reports Home (see docs/pages/reports-home.html).
// Gated entirely by view_reports. Every section here shows counts/trends
// only — no individual record, name, or message content — which is exactly
// why view_reports alone suffices for incident and call aggregates even
// without view_incidents / view_calls. Any future drill-down showing an
// individual record must fall back to that record's own gate instead.
export function ReportsHomePage() {
  const current = useCurrent();
  const canView = current.can("view_reports");
  const [days, setDays] = useState(30);

  // These are aggregate counts, and every one of them is bounded by what the
  // device holds. That is a real limit worth knowing: the age-scoped streams
  // keep about a month, so "last year" reports on the last month of data. The
  // fix is a server-side report, not a wider sync window — see docs/ROADMAP.md.
  const { data: shifts } = useShifts();
  const { data: allIncidents } = useIncidents();
  const { data: tickets } = useTickets();
  const { data: allCalls } = useCalls(500);
  const { data: allThreads } = useSmsThreads();

  const since = useMemo(() => Date.now() - days * 24 * 3600_000, [days]);

  if (!canView) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
      </div>
    );
  }

  const inRange = (ts: string | number | null | undefined) =>
    ts != null && new Date(ts).getTime() >= since;

  const incidents = allIncidents.filter((i) => inRange(i.created_at));
  const ticketsCreated = tickets.filter((t) => inRange(t.created_at));
  const ticketsResolved = tickets.filter((t) => inRange(t.resolved_at));
  const calls = allCalls.filter((c) => inRange(c.started_at));
  const missedCalls = calls.filter((c) => c.missed === 1);
  const smsThreads = allThreads.filter((t) => inRange(t.last_message_at));

  const incidentsByStatus = countBy(incidents, (i) => i.status_name);
  const incidentsByType = countBy(incidents, (i) => i.type_name ?? "Untyped");

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Reports</h1>
        <select
          className="select select-inline"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      <div className="grid-cards">
        <div className="card">
          <div className="card-kicker">Incident history</div>
          <div className="dash-count">{incidents.length}</div>
          <div className="card-meta">logged in the last {days} days</div>
          <div className="stack" style={{ gap: 4, marginTop: 10 }}>
            {Object.entries(incidentsByStatus).map(([k, n]) => (
              <div key={k} className="spread small">
                <span>{k}</span>
                <span className="muted">{n}</span>
              </div>
            ))}
            {incidents.length === 0 && (
              <span className="muted small">None in this range.</span>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-kicker">Incidents by type</div>
          <div className="stack" style={{ gap: 4, marginTop: 6 }}>
            {Object.entries(incidentsByType)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) => (
                <div key={k} className="spread small">
                  <span>{k}</span>
                  <span className="muted">{n}</span>
                </div>
              ))}
            {incidents.length === 0 && (
              <span className="muted small">None in this range.</span>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-kicker">Ticket throughput</div>
          <div className="dash-count">
            {ticketsCreated.length} / {ticketsResolved.length}
          </div>
          <div className="card-meta">created / resolved in the last {days} days</div>
          <div className="stack" style={{ gap: 4, marginTop: 10 }}>
            <div className="spread small">
              <span>Currently open</span>
              <span className="muted">
                {tickets.filter((t) => t.status_is_terminal === 0).length}
              </span>
            </div>
            <div className="spread small">
              <span>Auto-generated</span>
              <span className="muted">
                {ticketsCreated.filter((t) => t.auto_generated === 1).length}
              </span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-kicker">Call &amp; message volume</div>
          <div className="dash-count">{calls.length}</div>
          <div className="card-meta">calls in the last {days} days</div>
          <div className="stack" style={{ gap: 4, marginTop: 10 }}>
            <div className="spread small">
              <span>Missed</span>
              <span className="muted">{missedCalls.length}</span>
            </div>
            <div className="spread small">
              <span>SMS threads active</span>
              <span className="muted">{smsThreads.length}</span>
            </div>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            Volume only — individual calls and messages live in Comms.
          </p>
        </div>
      </div>

      <div className="section-title" style={{ marginTop: 20 }}>
        Shift reports
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {shifts.slice(0, 25).map((s) => (
          <Link
            key={s.id}
            to={`/reports/shifts/${s.id}`}
            className="card spread"
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <div>
              <div className="card-title">{s.guard_name ?? "Unassigned"}</div>
              <div className="card-meta">
                {new Date(s.started_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {s.ended_at
                  ? ` – ${new Date(s.ended_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}`
                  : " · in progress"}
              </div>
            </div>
            <span className={s.report_sent_at ? "badge badge-good" : "badge badge-warn"}>
              {s.report_sent_at ? "Sent" : "Not sent"}
            </span>
          </Link>
        ))}
        {shifts.length === 0 && (
          <div className="placeholder">
            <div className="big">No shifts yet</div>
            Shift reports appear here once guards start clocking in.
          </div>
        )}
      </div>
    </div>
  );
}

function countBy<T>(rows: T[], key: (row: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = key(row);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
