import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { attachmentLink, type AttachmentTarget } from "../../lib/attachments";
import { AttachmentTargetPicker } from "../shared/AttachmentTargetPicker";
import type { NewTicketState } from "../tickets/NewTicketPage";

export interface NewIncidentState {
  target?: AttachmentTarget;
}

// Incidents — New Incident Form (see pages/new-incident-form.html).
// Deliberately lightweight: short title required, everything else optional —
// built for a guard on a dark dock, fully offline-capable.
export function NewIncidentPage() {
  const current = useCurrent();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as NewIncidentState;

  const [title, setTitle] = useState("");
  const [typeId, setTypeId] = useState("");
  const [newTypeName, setNewTypeName] = useState("");
  const [addingType, setAddingType] = useState(false);
  const [details, setDetails] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [target, setTarget] = useState<AttachmentTarget | null>(state.target ?? null);
  const [targetLocked, setTargetLocked] = useState(Boolean(state.target));
  const [raiseTicketAfter, setRaiseTicketAfter] = useState(false);
  const [saving, setSaving] = useState(false);

  const { data } = db.useQuery({
    incidentTypes: {},
    users: { $: { where: { active: true } } },
  });
  const types = data?.incidentTypes ?? [];
  const users = data?.users ?? [];

  if (!current.can("create_incidents")) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
      </div>
    );
  }

  const addType = async () => {
    if (!newTypeName.trim()) return;
    const newId = id();
    await db.transact(db.tx.incidentTypes[newId].update({ name: newTypeName.trim() }));
    setTypeId(newId);
    setNewTypeName("");
    setAddingType(false);
  };

  const submit = async () => {
    if (!title.trim() || !target) return;
    setSaving(true);
    const incidentId = id();
    await db.transact(
      db.tx.incidents[incidentId]
        .update({
          title: title.trim(),
          status: "open",
          details: details.trim() || undefined,
          createdAt: Date.now(),
        })
        .link({
          ...attachmentLink(target),
          ...(current.user ? { author: current.user.id } : {}),
          ...(typeId ? { type: typeId } : {}),
          ...(assigneeId ? { assignedTo: assigneeId } : {}),
        }),
    );
    if (raiseTicketAfter) {
      navigate("/tickets/new", {
        replace: true,
        state: {
          sourceIncidentId: incidentId,
          target,
          title: `Incident: ${title.trim()}`,
        } satisfies NewTicketState,
      });
    } else {
      navigate(`/incidents/${incidentId}`, { replace: true });
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="page-head">
        <h1 className="page-title">Log Incident</h1>
      </div>

      <div className="field">
        <span className="field-label">Title — required, short by design</span>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </div>

      <div className="field">
        <span className="field-label">Type</span>
        {addingType ? (
          <div className="row">
            <input
              className="input"
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              placeholder="New type name"
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={!newTypeName.trim()}
              onClick={() => void addType()}
            >
              Add
            </button>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setAddingType(false)}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="row">
            <select
              className="select"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
            >
              <option value="">Select…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setAddingType(true)}
              title="Add a new incident type — the list grows per marina"
            >
              + New type
            </button>
          </div>
        )}
      </div>

      <div className="field">
        <span className="field-label">Details (markdown, optional)</span>
        <textarea
          className="textarea"
          rows={4}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
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

      <div className="field">
        <span className="field-label">Assignee (optional)</span>
        <select
          className="select"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
        >
          <option value="">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>

      <label className="row" style={{ cursor: "pointer", marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={raiseTicketAfter}
          onChange={(e) => setRaiseTicketAfter(e.target.checked)}
        />
        <span className="small">Also raise a linked ticket</span>
      </label>

      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!title.trim() || !target || saving}
          onClick={() => void submit()}
        >
          Log Incident
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
