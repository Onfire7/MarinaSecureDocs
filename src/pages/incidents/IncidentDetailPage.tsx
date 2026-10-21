import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { dataT, dateTime } from "../../i18n";
import { attachmentOf, targetPath } from "../../data/attachments";
import type { NewTicketState } from "../tickets/NewTicketPage";
import { incidentStatusBadgeClass } from "../../lib/workItems";
import { describeUpdate, isChange, mergeTimeline } from "../../lib/recordHistory";
import {
  addIncidentComment,
  assignIncident,
  editIncidentOriginal,
  setIncidentStatus,
  useCanEditOriginal,
  useIncident,
  useIncidentComments,
  useIncidentUpdates,
  useTicketsFromIncident,
} from "../../data/incidents";
import { useIncidentStatuses } from "../../data/lookups";
import { useUsers } from "../../data/users";

// Incidents — Incident Detail (see IncidentDetailPage.spec.md).
// Two distinct edit windows: the original content locks to its author at the
// end of their shift; the timeline — addenda and Incident Updates, by time —
// never locks for anyone holding create_incidents.

export function IncidentDetailPage() {
  const { id: incidentId } = useParams();
  const current = useCurrent();
  const navigate = useNavigate();
  const { t } = useTranslation("incidents");
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);

  const { incident } = useIncident(incidentId);
  const { data: users } = useUsers();
  const { statuses } = useIncidentStatuses();
  const { data: comments } = useIncidentComments(incidentId);
  const { data: updates } = useIncidentUpdates(incidentId);
  const { data: linkedTickets } = useTicketsFromIncident(incidentId);
  // Hooks before any early return — the author-edit window is a query, and a
  // conditional one would break the rules of hooks on the branch below.
  const canEditOriginal = useCanEditOriginal(incident, current.user?.id);

  if (!current.can("view_incidents")) {
    return (
      <div className="placeholder">
        <div className="big">{t("detail.nothingToSee")}</div>
      </div>
    );
  }
  if (!incident) {
    return (
      <div className="placeholder">
        <div className="big">{t("detail.loading")}</div>
      </div>
    );
  }

  const target = attachmentOf(incident);
  const canHandle = current.can("create_incidents");
  const actorId = current.user?.id ?? null;
  const when = (ts: string) => dateTime(ts, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  // A change that changes nothing is not written (spec § Actions).
  const setStatus = (statusId: string) => {
    const status = statuses.find((st) => st.id === statusId);
    if (status && isChange(incident.status_id, statusId)) void setIncidentStatus(incident, status, actorId);
  };
  const assign = (userId: string) => {
    if (!userId || !isChange(incident.assigned_to_id, userId)) return;
    const assignee = users.find((u) => u.id === userId);
    void assignIncident(incident, { id: userId, name: assignee?.name ?? "" }, actorId);
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
        // Becomes the ticket's title: data, in the marina's language.
        title: dataT("ticketTitle", { ns: "incidents", title: incident.title }),
      } satisfies NewTicketState,
    });
  };

  const timeline = mergeTimeline(comments, updates);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{incident.title}</h1>
          <div className="page-sub">
            {incident.type_name
              ? t("detail.bylineTyped", { type: incident.type_name, author: incident.author_name ?? "—", when: when(incident.created_at) })
              : t("detail.byline", { author: incident.author_name ?? "—", when: when(incident.created_at) })}
          </div>
        </div>
        <div className="row">
          {canEditOriginal && !editing && (
            <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
              {t("detail.edit")}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={raiseTicket}>
            {t("detail.raiseTicket")}
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div>
          <div className="field">
            <span className="field-label">{t("detail.status")}</span>
            <div className="field-value row">
              {canHandle ? (
                <select
                  className="select select-inline"
                  aria-label={t("detail.status")}
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
                <span className={incidentStatusBadgeClass(incident.status_name)}>{incident.status_name}</span>
              )}
            </div>
          </div>

          <div className="field">
            <span className="field-label">{t("detail.assignedTo")}</span>
            <div className="field-value row">
              <span>{incident.assignee_name ?? <span className="muted">{t("detail.unassigned")}</span>}</span>
              {canHandle && (
                <select
                  className="select select-inline"
                  aria-label={t("detail.assignedTo")}
                  value=""
                  onChange={(e) => assign(e.target.value)}
                >
                  <option value="">{t("detail.assignPlaceholder")}</option>
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
              <span className="field-label">{t("detail.attachedTo")}</span>
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
            <p className="muted small">{t("detail.noDetails")}</p>
          )}

          {linkedTickets.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div className="section-title">{t("detail.linkedTickets")}</div>
              <div className="stack" style={{ gap: 8 }}>
                {linkedTickets.map((lt) => (
                  <Link
                    key={lt.id}
                    to={`/tickets/${lt.id}`}
                    className="card spread"
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <span>{lt.title}</span>
                    <span className="badge">{lt.status_name}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="section-title">{t("detail.timeline")}</div>
          <ol className="stack" data-testid="incident-timeline" style={{ gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
            {timeline.map((entry) =>
              entry.kind === "addendum" ? (
                <li key={`a-${entry.row.id}`} className="card" data-kind="addendum">
                  <div className="small" style={{ whiteSpace: "pre-wrap" }}>
                    {entry.row.body}
                  </div>
                  <div className="card-meta">
                    {t("timeline.addendum")} ·{" "}
                    {t("timeline.by", { name: entry.row.author_name ?? "—", when: when(entry.row.created_at) })}
                  </div>
                </li>
              ) : (
                <li key={`u-${entry.row.id}`} className="card" data-kind={entry.row.kind}>
                  <div className="small">
                    {t(describeUpdate(entry.row).key as "timeline.status", describeUpdate(entry.row).values as { from: string; to: string })}
                  </div>
                  <div className="card-meta">
                    {t("timeline.by", { name: entry.row.author_name ?? "—", when: when(entry.row.created_at) })}
                  </div>
                </li>
              ),
            )}
            {timeline.length === 0 && <li className="muted small">{t("detail.noTimeline")}</li>}
          </ol>

          {canHandle && (
            <div style={{ marginTop: 12 }}>
              <textarea
                className="textarea"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t("detail.addendumPlaceholder")}
                aria-label={t("detail.addendumPlaceholder")}
              />
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!comment.trim()}
                  onClick={() => void addComment()}
                >
                  {t("detail.addAddendum")}
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
  const { t } = useTranslation("incidents");
  const [title, setTitle] = useState(initialTitle);
  const [details, setDetails] = useState(initialDetails);

  const save = async () => {
    await editIncidentOriginal(incidentId, title.trim(), details.trim(), current.user?.id ?? null);
    onDone();
  };

  return (
    <div className="card">
      <div className="field">
        <span className="field-label">{t("detail.editTitle")}</span>
        <input className="input" aria-label={t("detail.editTitle")} value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <span className="field-label">{t("detail.editDetails")}</span>
        <textarea
          className="textarea"
          aria-label={t("detail.editDetails")}
          rows={5}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary btn-sm" disabled={!title.trim()} onClick={() => void save()}>
          {t("detail.save")}
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onDone}>
          {t("detail.cancel")}
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>
        {t("detail.editHint")}
      </p>
    </div>
  );
}
