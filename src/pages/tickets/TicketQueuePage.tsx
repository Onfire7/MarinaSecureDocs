import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { statusLabel } from "../../lib/locations";
import {
  ATTACHMENT_LINKS_QUERY,
  attachmentOf,
  targetPath,
} from "../../lib/attachments";
import { PRIORITY_ORDER, priorityBadgeClass } from "../../lib/workItems";

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

  const { data } = db.useQuery({
    tickets: {
      assignedTo: {},
      sourceIncident: {},
      ...ATTACHMENT_LINKS_QUERY,
    },
    users: { $: { where: { active: true } } },
  });

  const tickets = useMemo(() => {
    const rank = (p: string) => {
      const i = (PRIORITY_ORDER as readonly string[]).indexOf(p);
      return i === -1 ? PRIORITY_ORDER.length : i;
    };
    return [...(data?.tickets ?? [])].sort(
      (a, b) =>
        rank(a.priority) - rank(b.priority) ||
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }, [data]);
  const users = data?.users ?? [];

  const statuses = useMemo(
    () => [...new Set(tickets.map((t) => t.status))],
    [tickets],
  );

  const filtered = tickets.filter(
    (t) =>
      (!priorityFilter || t.priority === priorityFilter) &&
      (!statusFilter || t.status === statusFilter) &&
      (!assigneeFilter ||
        (assigneeFilter === "unassigned"
          ? !t.assignedTo
          : t.assignedTo?.id === assigneeFilter)),
  );

  const take = (ticketId: string) => {
    if (!current.user) return;
    void db.transact(db.tx.tickets[ticketId].link({ assignedTo: current.user.id }));
  };
  const assign = (ticketId: string, userId: string) => {
    if (!userId) return;
    void db.transact(db.tx.tickets[ticketId].link({ assignedTo: userId }));
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
              {statusLabel(s)}
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
                    <span className="badge">{statusLabel(t.status)}</span>
                    {target && (
                      <>
                        {" · "}
                        <Link to={targetPath(target)}>{target.label}</Link>
                      </>
                    )}
                    {t.autoGenerated && (
                      <>
                        {" "}
                        <span className="badge badge-accent">Auto</span>
                      </>
                    )}
                    {t.sourceIncident && current.can("view_incidents") && (
                      <>
                        {" "}
                        <Link to={`/incidents/${t.sourceIncident.id}`} className="badge badge-accent">
                          Incident
                        </Link>
                      </>
                    )}
                  </div>
                </div>
                <div className="row">
                  {t.assignedTo ? (
                    <span className="muted small">{t.assignedTo.name}</span>
                  ) : (
                    canTake && (
                      <button type="button" className="btn btn-sm" onClick={() => take(t.id)}>
                        Take
                      </button>
                    )
                  )}
                  {canAssign && !isMobile && (
                    <select
                      className="select select-inline"
                      value=""
                      onChange={(e) => assign(t.id, e.target.value)}
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
