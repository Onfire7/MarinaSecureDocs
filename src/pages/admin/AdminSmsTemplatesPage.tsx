import { useMemo, useState } from "react";
import {
  createSmsTemplate,
  deleteSmsTemplate,
  saveSmsTemplate,
  useSmsTemplates,
} from "../../data/comms";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";

// Admin — SMS Templates (see docs/pages/admin-sms-templates.html).
// Global scope only. Personal templates belong to individual users and are
// managed inline from the SMS thread, untouched by this permission.
export function AdminSmsTemplatesPage() {
  return (
    <AdminGate requires="manage_marina_settings">
      <SmsTemplates />
    </AdminGate>
  );
}

function SmsTemplates() {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ label: "", body: "" });

  // Global scope only. Personal templates belong to their owner and are
  // managed inline from the SMS thread; this screen does not touch them.
  const { data: all } = useSmsTemplates(undefined);
  const templates = useMemo(
    () => all.filter((t) => t.scope === "global"),
    [all],
  );

  const startEdit = (t?: { id: string; label: string; body: string }) => {
    setEditing(t?.id ?? "new");
    setForm(t ? { label: t.label, body: t.body } : { label: "", body: "" });
  };

  const save = async () => {
    if (!form.label.trim() || !form.body.trim()) return;
    if (editing === "new") {
      await createSmsTemplate({
        label: form.label.trim(),
        body: form.body.trim(),
        scope: "global",
        ownerId: null,
      });
    } else {
      await saveSmsTemplate(editing!, {
        label: form.label.trim(),
        body: form.body.trim(),
      });
    }
    setEditing(null);
  };

  const remove = async (templateId: string) => {
    // Already-sent messages are plain text, not live references, so removing a
    // template never changes message history.
    await deleteSmsTemplate(templateId);
  };

  return (
    <div>
      <AdminHeader title="SMS Templates">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => startEdit()}
        >
          + New template
        </button>
      </AdminHeader>

      {editing && (
        <div className="card" style={{ marginBottom: 16, maxWidth: 560 }}>
          <div className="field">
            <span className="field-label">Label</span>
            <input
              className="input"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. Slip ready"
              autoFocus
            />
          </div>
          <div className="field">
            <span className="field-label">Message body</span>
            <textarea
              className="textarea"
              rows={3}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!form.label.trim() || !form.body.trim()}
              onClick={() => void save()}
            >
              Save
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="stack" style={{ gap: 8 }}>
        {templates.map((t) => (
          <div key={t.id} className="card spread" style={{ flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div className="card-title">{t.label}</div>
              <div className="card-meta" style={{ whiteSpace: "pre-wrap" }}>
                {t.body}
              </div>
            </div>
            <div className="row">
              <button
                type="button"
                className="btn btn-sm btn-quiet"
                onClick={() => startEdit(t)}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void remove(t.id)}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {templates.length === 0 && !editing && (
          <div className="placeholder">
            <div className="big">No global templates yet</div>
            Users can still make their own personal templates from Comms.
          </div>
        )}
      </div>
    </div>
  );
}
