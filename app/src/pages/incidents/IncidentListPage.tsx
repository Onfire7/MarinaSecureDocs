import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { statusLabel } from "../../lib/locations";
import {
  ATTACHMENT_LINKS_QUERY,
  attachmentOf,
  targetPath,
} from "../../lib/attachments";
import { incidentStatusBadgeClass } from "../../lib/workItems";

// Incidents — Incident List (see pages/incident-list.html).
// The one entity whose visibility itself is a hard gate: without
// view_incidents this page shows nothing (nav already hides it).
export function IncidentListPage() {
  const current = useCurrent();
  const canView = current.can("view_incidents");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const { data } = db.useQuery(
    canView
      ? {
          incidents: {
            type: {},
            author: {},
            assignedTo: {},
            ...ATTACHMENT_LINKS_QUERY,
          },
          incidentTypes: {},
        }
      : null,
  );

  const incidents = useMemo(
    () =>
      [...(data?.incidents ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [data],
  );
  const types = data?.incidentTypes ?? [];
  const statuses = useMemo(
    () => [...new Set(incidents.map((i) => i.status))],
    [incidents],
  );

  if (!canView) {
    // Reachable only by direct URL; the nav item is hidden without the permission.
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
      </div>
    );
  }

  const filtered = incidents.filter(
    (i) =>
      (!statusFilter || i.status === statusFilter) &&
      (!typeFilter || i.type?.id === typeFilter),
  );

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Incidents</h1>
        {current.can("create_incidents") && (
          <Link to="/incidents/new" className="btn btn-sm btn-primary">
            + Log Incident
          </Link>
        )}
      </div>

      <div className="chip-row">
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
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="placeholder">
          <div className="big">
            {incidents.length === 0 ? "No incidents logged" : "Nothing matches these filters"}
          </div>
          {incidents.length === 0 && "A quiet marina is a good sign."}
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {filtered.map((i) => {
            const target = attachmentOf(i);
            return (
              <div key={i.id} className="card spread" style={{ flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <Link to={`/incidents/${i.id}`} className="card-title" style={{ display: "block" }}>
                    {i.title}
                  </Link>
                  <div className="card-meta">
                    <span className={incidentStatusBadgeClass(i.status)}>
                      {i.status === "custom"
                        ? (i.customStatus ?? "Custom")
                        : statusLabel(i.status)}
                    </span>
                    {i.type && ` · ${i.type.name}`}
                    {target && (
                      <>
                        {" · "}
                        <Link to={targetPath(target)}>{target.label}</Link>
                      </>
                    )}
                  </div>
                </div>
                <div className="muted small" style={{ textAlign: "right" }}>
                  {i.author?.name ?? "—"}
                  <br />
                  {new Date(i.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {i.assignedTo && (
                    <>
                      <br />→ {i.assignedTo.name}
                    </>
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
