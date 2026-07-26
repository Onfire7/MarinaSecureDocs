import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { statusLabel } from "../../lib/locations";
import {
  ATTACHMENT_LINKS_QUERY,
  attachmentOf,
  targetPath,
} from "../../lib/attachments";
import type { NewTicketState } from "../tickets/NewTicketPage";
import { incidentStatusBadgeClass } from "../../lib/workItems";
import { activityTx } from "../../lib/activityLog";

// Incidents — Incident Detail (see pages/incident-detail.html).
// Two distinct edit windows: the original content locks to its author at the
// end of their shift; the addendum thread never locks for anyone holding
// create_incidents.
const INCIDENT_STATUSES = ["open", "under_review", "resolved", "closed"] as const;

export function IncidentDetailPage() {
  const { id: incidentId } = useParams();
  const current = useCurrent();
  const navigate = useNavigate();
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);

  const { data } = db.useQuery(
    incidentId
      ? {
          incidents: {
            $: { where: { id: incidentId } },
            type: {},
            author: { shifts: {} },
            assignedTo: {},
            comments: { author: {} },
            linkedTickets: {},
            ...ATTACHMENT_LINKS_QUERY,
          },
          users: { $: { where: { active: true } } },
        }
      : null,
  );
  const incident = data?.incidents?.[0];
  const users = data?.users ?? [];

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
  const isAuthor = Boolean(current.user && incident.author?.id === current.user.id);

  // Author-edit window: open while the author's shift containing the
  // incident's creation is still running. An author with no shift records at
  // all (e.g. office staff who never clock in) is never locked out — the
  // shift boundary simply doesn't exist for them.
  const authorShifts = incident.author?.shifts ?? [];
  const createdAt = new Date(incident.createdAt).getTime();
  const containingShiftOpen = authorShifts.some(
    (s) => new Date(s.startedAt).getTime() <= createdAt && !s.endedAt,
  );
  const canEditOriginal =
    isAuthor && (authorShifts.length === 0 || containingShiftOpen);

  const logIncident = (eventType: string, summary: string) =>
    activityTx({
      eventType,
      summary,
      subjectType: "incidents",
      subjectId: incident.id,
      actorId: current.user?.id,
    });

  const setStatus = (status: string) => {
    void db.transact([
      db.tx.incidents[incident.id].update({ status }),
      logIncident(
        "incident.status_changed",
        `"${incident.title}" set to ${statusLabel(status)}`,
      ),
    ]);
  };
  const assign = (userId: string) => {
    if (!userId) return;
    const assignee = users.find((u) => u.id === userId);
    void db.transact([
      db.tx.incidents[incident.id].link({ assignedTo: userId }),
      logIncident(
        "incident.assigned",
        `"${incident.title}" assigned to ${assignee?.name ?? "someone"}`,
      ),
    ]);
  };
  const addComment = async () => {
    if (!comment.trim() || !current.user) return;
    await db.transact([
      db.tx.incidentComments[id()]
        .update({ body: comment.trim(), createdAt: Date.now() })
        .link({ incident: incident.id, author: current.user.id }),
      logIncident("incident.commented", `Addendum added to "${incident.title}"`),
    ]);
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

  const comments = [...(incident.comments ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{incident.title}</h1>
          <div className="page-sub">
            {incident.type?.name ? `${incident.type.name} · ` : ""}
            {incident.author?.name ?? "—"} ·{" "}
            {new Date(incident.createdAt).toLocaleString(undefined, {
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
                  value={incident.status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {[...new Set([...INCIDENT_STATUSES, incident.status])].map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={incidentStatusBadgeClass(incident.status)}>
                  {statusLabel(incident.status)}
                </span>
              )}
            </div>
          </div>

          <div className="field">
            <span className="field-label">Assigned to</span>
            <div className="field-value row">
              <span>
                {incident.assignedTo?.name ?? <span className="muted">Unassigned</span>}
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

          {(incident.linkedTickets ?? []).length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="section-title">Linked tickets</div>
              <div className="stack" style={{ gap: 8 }}>
                {(incident.linkedTickets ?? []).map((t) => (
                  <Link
                    key={t.id}
                    to={`/tickets/${t.id}`}
                    className="card spread"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <span>{t.title}</span>
                    <span className="badge">{statusLabel(t.status)}</span>
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
                  {c.author?.name ?? "—"} ·{" "}
                  {new Date(c.createdAt).toLocaleString(undefined, {
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
    await db.transact([
      db.tx.incidents[incidentId].update({
        title: title.trim(),
        details: details.trim() || undefined,
      }),
      activityTx({
        eventType: "incident.edited",
        summary: `"${title.trim()}" edited by its author`,
        subjectType: "incidents",
        subjectId: incidentId,
        actorId: current.user?.id,
      }),
    ]);
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
