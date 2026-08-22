import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { statusLabel } from "../../lib/locations";
import type { AttachmentTarget } from "../../lib/attachments";
import { NoteDialog } from "./NoteDialog";

interface NoteRow {
  id: string;
  body: string;
  createdAt: string | number;
  author?: { name: string } | null;
}
interface IncidentRow {
  id: string;
  title: string;
  status: string;
}
interface TicketRow {
  id: string;
  title: string;
  priority: string;
  status: string;
}

// The attached notes/incidents/tickets lists + create actions every
// attachment target's detail page shares (locations, boats, vehicles, …).
// Incidents render only with view_incidents; notes and tickets always.
export function TargetActivity({
  target,
  notes,
  incidents,
  tickets,
}: {
  target: AttachmentTarget;
  notes: NoteRow[];
  incidents: IncidentRow[];
  tickets: TicketRow[];
}) {
  const current = useCurrent();
  const navigate = useNavigate();
  const [showNote, setShowNote] = useState(false);

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
          {[...notes]
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .map((n) => (
              <div key={n.id} className="card">
                <div className="small" style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
                <div className="card-meta">
                  {n.author?.name ?? "—"} ·{" "}
                  {new Date(n.createdAt).toLocaleString(undefined, {
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
                <span className="badge">{statusLabel(i.status)}</span>
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
