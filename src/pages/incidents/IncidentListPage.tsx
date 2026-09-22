import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { attachmentOf, targetPath } from "../../data/attachments";
import { incidentStatusBadgeClass } from "../../lib/workItems";
import { useIncidents } from "../../data/incidents";
import { useIncidentTypes } from "../../data/lookups";

// Incidents — Incident List (see pages/incident-list.html).
// The one entity whose visibility itself is a hard gate: without
// view_incidents this page shows nothing (nav already hides it).
export function IncidentListPage() {
  const current = useCurrent();
  const canView = current.can("view_incidents");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  // No canView branch on the query itself: without view_incidents the incidents
  // table on this device is empty, because the sync stream never delivered a
  // row. The check below is for the nav, not for the data.
  const { data: incidents } = useIncidents();
  const { types } = useIncidentTypes();
  const statuses = useMemo(
    () => [...new Set(incidents.map((i) => i.status_name))],
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
      (!statusFilter || i.status_name === statusFilter) &&
      (!typeFilter || i.incident_type_id === typeFilter),
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
              {s}
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
                    <span className={incidentStatusBadgeClass(i.status_name)}>
                      {i.status_name}
                    </span>
                    {i.type_name && ` · ${i.type_name}`}
                    {target && (
                      <>
                        {" · "}
                        <Link to={targetPath(target)}>{target.label}</Link>
                      </>
                    )}
                  </div>
                </div>
                <div className="muted small" style={{ textAlign: "right" }}>
                  {i.author_name ?? "—"}
                  <br />
                  {new Date(i.created_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  {i.assignee_name && (
                    <>
                      <br />→ {i.assignee_name}
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
