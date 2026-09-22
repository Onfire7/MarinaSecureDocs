import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { statusLabel } from "../../lib/locations";
import { targetColumn, type AttachmentTarget } from "../../data/attachments";
import { useNotesForTarget } from "../../data/notes";
import { useTicketsForTarget } from "../../data/tickets";
import { useIncidentsForTarget } from "../../data/incidents";
import { NoteDialog } from "./NoteDialog";

// The attached notes/incidents/tickets lists + create actions every attachment
// target's detail page shares — locations, boats, vehicles, contacts, assets,
// checkpoints.
//
// It fetches its own three lists rather than taking them as props. Six detail
// pages used to each carry the same query fragments and pass the results down;
// the target itself is enough to derive all of it, and pushing that here is
// what keeps those pages free of the query.
//
// Incidents render only with view_incidents. On a device without it the query
// also returns nothing — the rows were never synced — so the permission check
// here is about the empty-state text, not about withholding data.
export function TargetActivity({ target }: { target: AttachmentTarget }) {
  const current = useCurrent();
  const navigate = useNavigate();
  const [showNote, setShowNote] = useState(false);
  const column = targetColumn(target.type);

  const { data: notes } = useNotesForTarget(column, target.id);
  const { data: incidents } = useIncidentsForTarget(column, target.id);
  const { data: tickets } = useTicketsForTarget(column, target.id);

  return (
    <div className="stack">
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm" onClick={() => setShowNote(true)}>
          + Note
        </button>
        {current.can("create_incidents") && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigate("/incidents/new", { state: { target } })}
          >
            + Incident
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => navigate("/tickets/new", { state: { target } })}
        >
          + Ticket
        </button>
      </div>

      <div>
        <div className="section-title">Notes ({notes.length})</div>
        <div className="stack" style={{ gap: 6 }}>
          {notes.map((n) => (
            <div key={n.id} className="card">
              <div className="small" style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
              <div className="card-meta">
                {n.author_name ?? "—"} ·{" "}
                {new Date(n.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
            </div>
          ))}
          {notes.length === 0 && <span className="muted small">No notes yet.</span>}
        </div>
      </div>

      {current.can("view_incidents") && (
        <div>
          <div className="section-title">Incidents ({incidents.length})</div>
          <div className="stack" style={{ gap: 6 }}>
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
            {incidents.length === 0 && <span className="muted small">No incidents.</span>}
          </div>
        </div>
      )}

      <div>
        <div className="section-title">Tickets ({tickets.length})</div>
        <div className="stack" style={{ gap: 6 }}>
          {tickets.map((t) => (
            <Link
              key={t.id}
              to={`/tickets/${t.id}`}
              className="card spread"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <span>{t.title}</span>
              <span
                className={
                  t.priority === "urgent" || t.priority === "high" ? "badge badge-bad" : "badge"
                }
              >
                {statusLabel(t.priority)}
              </span>
            </Link>
          ))}
          {tickets.length === 0 && <span className="muted small">No tickets.</span>}
        </div>
      </div>

      {showNote && <NoteDialog target={target} onClose={() => setShowNote(false)} />}
    </div>
  );
}
