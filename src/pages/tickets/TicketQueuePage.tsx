import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { statusLabel } from "../../lib/locations";
import { attachmentOf, targetPath } from "../../data/attachments";
import { PRIORITY_ORDER, priorityBadgeClass } from "../../lib/workItems";
import { assignTicket, useTickets } from "../../data/tickets";
import { useUsers } from "../../data/users";

// Tickets — Ticket Queue (see pages/ticket-queue.html).
// Deliberately no view permission: every role sees the queue and can create
// tickets. Only taking/assigning is gated.

export function TicketQueuePage() {
  const current = useCurrent();
  const isMobile = useIsMobile();
  const canTake = current.can("assign_ticket_to_self");
  const canAssign = current.can("assign_ticket_to_others");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  // Already ordered by priority then recency — the sort lives in SQL rather
  // than in a useMemo that would re-run on every keystroke in the filters.
  const { data: tickets } = useTickets();
  const { data: users } = useUsers();

  const statuses = useMemo(
    () => [...new Set(tickets.map((t) => t.status_name))],
    [tickets],
  );

  const filtered = tickets.filter(
    (t) =>
      (!priorityFilter || t.priority === priorityFilter) &&
      (!statusFilter || t.status_name === statusFilter) &&
      (!assigneeFilter ||
        (assigneeFilter === "unassigned"
          ? !t.assigned_to_id
          : t.assigned_to_id === assigneeFilter)),
  );

  const take = (ticketId: string, title: string) => {
    if (!current.user) return;
    void assignTicket(
      { id: ticketId, title },
      { id: current.user.id, name: current.user.name },
      current.user.id,
    );
  };
  const assign = (ticketId: string, title: string, userId: string) => {
    if (!userId) return;
    const assignee = users.find((u) => u.id === userId);
    void assignTicket(
      { id: ticketId, title },
      { id: userId, name: assignee?.name ?? "someone" },
      current.user?.id ?? null,
    );
  };

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Tickets</h1>
        <Link to="/tickets/new" className="btn btn-sm btn-primary">
          + New Ticket
        </Link>
      </div>

      <div className="chip-row">
        <select
          className="select select-inline"
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
        >
          <option value="">All priorities</option>
          {PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>
              {statusLabel(p)}
            </option>
          ))}
        </select>
        <select
          className="select select-inline"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="select select-inline"
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
        >
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="placeholder">
          <div className="big">
            {tickets.length === 0 ? "No open tickets" : "Nothing matches these filters"}
          </div>
          {tickets.length === 0 && "A clear queue is a good sign."}
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {filtered.map((t) => {
            const target = attachmentOf(t);
            return (
              <div key={t.id} className="card spread" style={{ flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <Link to={`/tickets/${t.id}`} className="card-title" style={{ display: "block" }}>
                    {t.title}
                  </Link>
                  <div className="card-meta">
                    <span className={priorityBadgeClass(t.priority)}>
                      {statusLabel(t.priority)}
                    </span>{" "}
                    <span className="badge">{t.status_name}</span>
                    {target && (
                      <>
                        {" · "}
                        <Link to={targetPath(target)}>{target.label}</Link>
                      </>
                    )}
                    {t.auto_generated === 1 && (
                      <>
                        {" "}
                        <span className="badge badge-accent">Auto</span>
                      </>
                    )}
                    {t.source_incident_id && current.can("view_incidents") && (
                      <>
                        {" "}
                        <Link to={`/incidents/${t.source_incident_id}`} className="badge badge-accent">
                          Incident
                        </Link>
                      </>
                    )}
                  </div>
                </div>
                <div className="row">
                  {t.assigned_to_id ? (
                    <span className="muted small">{t.assignee_name}</span>
                  ) : (
                    canTake && (
                      <button type="button" className="btn btn-sm" onClick={() => take(t.id, t.title)}>
                        Take
                      </button>
                    )
                  )}
                  {canAssign && !isMobile && (
                    <select
                      className="select select-inline"
                      value=""
                      onChange={(e) => assign(t.id, t.title, e.target.value)}
                    >
                      <option value="">Assign…</option>
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
