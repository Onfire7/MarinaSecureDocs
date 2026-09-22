import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { statusLabel } from "../../lib/locations";
import type { AttachmentTarget } from "../../data/attachments";
import { AttachmentTargetPicker } from "../shared/AttachmentTargetPicker";
import { PRIORITY_ORDER } from "../../lib/workItems";
import { createTicket } from "../../data/tickets";
import { useTicketStatuses } from "../../data/lookups";

// Navigation state accepted from callers opening this form in context —
// e.g. Location Detail pre-attaching its own location, or Incident Detail
// raising a linked ticket (sourceIncidentId is never user-editable).
export interface NewTicketState {
  target?: AttachmentTarget;
  sourceIncidentId?: string;
  title?: string;
  description?: string;
}

// Tickets — New Ticket Form (see pages/new-ticket-form.html).
// Unrestricted by design; always created unassigned, status Open.
export function NewTicketPage() {
  const current = useCurrent();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as NewTicketState;

  const [title, setTitle] = useState(state.title ?? "");
  const [description, setDescription] = useState(state.description ?? "");
  const [priority, setPriority] = useState("medium");
  const [target, setTarget] = useState<AttachmentTarget | null>(state.target ?? null);
  const [targetLocked, setTargetLocked] = useState(Boolean(state.target));
  const [saving, setSaving] = useState(false);

  // A ticket opens in the first non-terminal status the marina defines. There
  // is no hardcoded "open": the statuses are rows now, and a marina that
  // renamed its first one to "Reported" should get a ticket in it.
  const { statuses } = useTicketStatuses();
  const openStatus = statuses.find((s) => s.is_terminal === 0) ?? statuses[0];

  const submit = async () => {
    if (!title.trim() || !target || !openStatus) return;
    setSaving(true);
    const ticketId = await createTicket(
      {
        title: title.trim(),
        description: description.trim(),
        priority,
        target,
        statusId: openStatus.id,
        sourceIncidentId: state.sourceIncidentId,
      },
      current.user?.id ?? null,
    );
    navigate(`/tickets/${ticketId}`, { replace: true });
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="page-head">
        <h1 className="page-title">New Ticket</h1>
      </div>

      <div className="field">
        <span className="field-label">Title — required</span>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </div>

      <div className="field">
        <span className="field-label">Description (markdown, optional)</span>
        <textarea
          className="textarea"
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="field">
        <span className="field-label">Priority</span>
        <select
          className="select select-inline"
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
        >
          {PRIORITY_ORDER.map((p) => (
            <option key={p} value={p}>
              {statusLabel(p)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <span className="field-label">Attachment target — required</span>
        {targetLocked && target ? (
          <div className="field-value">
            {target.label}{" "}
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => {
                setTarget(null);
                setTargetLocked(false);
              }}
            >
              Change
            </button>
          </div>
        ) : (
          <AttachmentTargetPicker value={target} onChange={setTarget} />
        )}
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!title.trim() || !target || !openStatus || saving}
          onClick={() => void submit()}
        >
          Create Ticket
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
