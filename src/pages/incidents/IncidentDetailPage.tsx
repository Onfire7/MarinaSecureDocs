import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { attachmentOf, targetPath } from "../../data/attachments";
import type { NewTicketState } from "../tickets/NewTicketPage";
import { incidentStatusBadgeClass } from "../../lib/workItems";
import {
  addIncidentComment,
  assignIncident,
  editIncidentOriginal,
  setIncidentStatus,
  useCanEditOriginal,
  useIncident,
  useIncidentComments,
  useTicketsFromIncident,
} from "../../data/incidents";
import { useIncidentStatuses } from "../../data/lookups";
import { useUsers } from "../../data/users";

// Incidents — Incident Detail (see pages/incident-detail.html).
// Two distinct edit windows: the original content locks to its author at the
// end of their shift; the addendum thread never locks for anyone holding
// create_incidents.

export function IncidentDetailPage() {
  const { id: incidentId } = useParams();
  const current = useCurrent();
  const navigate = useNavigate();
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);

  const { incident } = useIncident(incidentId);
  const { data: users } = useUsers();
  const { statuses } = useIncidentStatuses();
  const { data: comments } = useIncidentComments(incidentId);
  const { data: linkedTickets } = useTicketsFromIncident(incidentId);
  // Hooks before any early return — the author-edit window is a query, and a
  // conditional one would break the rules of hooks on the branch below.
  const canEditOriginal = useCanEditOriginal(incident, current.user?.id);

  if (!current.can("view_incidents")) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
      </div>
    );
  }
  if (!incident) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const target = attachmentOf(incident);
  const canHandle = current.can("create_incidents");
  const actorId = current.user?.id ?? null;

  const setStatus = (statusId: string) => {
    const status = statuses.find((st) => st.id === statusId);
    if (status) void setIncidentStatus(incident, status, actorId);
  };
  const assign = (userId: string) => {
    if (!userId) return;
    const assignee = users.find((u) => u.id === userId);
    void assignIncident(
      incident,
      { id: userId, name: assignee?.name ?? "someone" },
      actorId,
    );
  };
  const addComment = async () => {
    if (!comment.trim() || !current.user) return;
    await addIncidentComment(incident, comment.trim(), actorId);
    setComment("");
  };

  const raiseTicket = () => {
    navigate("/tickets/new", {
      state: {
        sourceIncidentId: incident.id,
        target: target ?? undefined,
        title: `Incident: ${incident.title}`,
      } satisfies NewTicketState,
    });
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{incident.title}</h1>
          <div className="page-sub">
            {incident.type_name ? `${incident.type_name} · ` : ""}
            {incident.author_name ?? "—"} ·{" "}
            {new Date(incident.created_at).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </div>
        </div>
        <div className="row">
          {canEditOriginal && !editing && (
            <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={raiseTicket}>
            Raise a ticket
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div>
          <div className="field">
            <span className="field-label">Status</span>
            <div className="field-value row">
              {canHandle ? (
                <select
                  className="select select-inline"
                  value={incident.status_id}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {statuses.some((st) => st.id === incident.status_id) || (
                    <option value={incident.status_id}>{incident.status_name}</option>
                  )}
                  {statuses.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={incidentStatusBadgeClass(incident.status_name)}>
                  {incident.status_name}
                </span>
              )}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Assigned to</span>
            <div className="field-value row">
              <span>
                {incident.assignee_name ?? (
                  <span className="muted">Unassigned</span>
                )}
              </span>
              {canHandle && (
                <select
                  className="select select-inline"
                  value=""
                  onChange={(e) => assign(e.target.value)}
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

          {target && (
            <div className="field">
              <span className="field-label">Attached to</span>
              <div className="field-value">
                <Link to={targetPath(target)}>{target.label}</Link>
              </div>
            </div>
          )}

          {editing ? (
            <EditOriginal
              incidentId={incident.id}
              initialTitle={incident.title}
              initialDetails={incident.details ?? ""}
              onDone={() => setEditing(false)}
            />
          ) : incident.details ? (
            <div className="card">
              <div className="small" style={{ whiteSpace: "pre-wrap" }}>
                {incident.details}
              </div>
            </div>
          ) : (
            <p className="muted small">No further details recorded.</p>
          )}

          {linkedTickets.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="section-title">Linked tickets</div>
              <div className="stack" style={{ gap: 8 }}>
                {linkedTickets.map((t) => (
                  <Link
                    key={t.id}
                    to={`/tickets/${t.id}`}
                    className="card spread"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <span>{t.title}</span>
                    <span className="badge">{t.status_name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="section-title">Addendums</div>
          <div className="stack" style={{ gap: 8 }}>
            {comments.map((c) => (
              <div key={c.id} className="card">
                <div className="small" style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
                <div className="card-meta">
                  {c.author_name ?? "—"} ·{" "}
                  {new Date(c.created_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ))}
            {comments.length === 0 && (
              <span className="muted small">No addendums yet.</span>
            )}
          </div>

          {canHandle && (
            <div style={{ marginTop: 12 }}>
              <textarea
                className="textarea"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add an addendum — permanent, append-only"
              />
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!comment.trim()}
                  onClick={() => void addComment()}
                >
                  Add addendum
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EditOriginal({
  incidentId,
  initialTitle,
  initialDetails,
  onDone,
}: {
  incidentId: string;
  initialTitle: string;
  initialDetails: string;
  onDone: () => void;
}) {
  const current = useCurrent();
  const [title, setTitle] = useState(initialTitle);
  const [details, setDetails] = useState(initialDetails);

  const save = async () => {
    await editIncidentOriginal(
      incidentId,
      title.trim(),
      details.trim(),
      current.user?.id ?? null,
    );
    onDone();
  };

  return (
    <div className="card">
      <div className="field">
        <span className="field-label">Title</span>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <span className="field-label">Details (markdown)</span>
        <textarea
          className="textarea"
          rows={5}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </div>
      <div className="row">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!title.trim()}
          onClick={() => void save()}
        >
          Save
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        Editable only by you, and only until your shift ends — addendums stay
        open afterward.
      </p>
    </div>
  );
}
