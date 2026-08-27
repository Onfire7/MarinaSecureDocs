import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { twilioRequest } from "../../lib/comms";
import {
  createSmsTemplate,
  deleteSmsTemplate,
  markThreadRead,
  useSmsMessages,
  useSmsTemplates,
  useSmsThread,
  type SmsTemplateRow,
} from "../../data/comms";

// Comms — SMS Thread (see docs/pages/sms-thread.html).
// Reaching this screen needs view_sms; sending is a separate gate
// (place_calls), so a user can legitimately have one without the other.
export function SmsThreadPage() {
  const { id: threadId } = useParams();
  const current = useCurrent();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [managingTemplates, setManagingTemplates] = useState(false);

  const canView = current.can("view_sms");
  const canSend = current.can("place_calls");

  const thread = useSmsThread(threadId);
  const { data: messages } = useSmsMessages(threadId);
  const { data: templates } = useSmsTemplates(current.user?.id);

  // Opening a thread marks it read — one-way, there's no "mark unread".
  const unread = thread?.unread === 1;
  useEffect(() => {
    if (threadId && unread) void markThreadRead(threadId);
  }, [threadId, unread]);

  if (!canView) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
      </div>
    );
  }
  if (!thread) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    setError(null);
    try {
      // The Twilio Function sends and creates the outbound SMSMessage itself
      // — the frontend never writes Twilio-sourced data.
      await twilioRequest("/sms/send", {
        threadId: thread.id,
        contactId: thread.contact_id,
        line: thread.line,
        body: body.trim(),
      });
      setBody("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            {thread.contact_name ?? "Unknown contact"}
          </h1>
          <div className="page-sub">
            {current.can("view_contact") && thread.contact_phone
              ? `${thread.contact_phone} · `
              : ""}
            {thread.line ? `via ${thread.line} · ` : ""}
            <Link to="/comms">← Comms</Link>
          </div>
        </div>
      </div>

      <div className="chat-scroll">
        {messages.map((m) => (
          <div
            key={m.id}
            className={"chat-msg" + (m.direction === "outbound" ? " chat-mine" : "")}
          >
            <div className="chat-meta">
              {m.direction === "outbound"
                ? (m.sent_by_name ?? "Marina")
                : (thread.contact_name ?? "Them")}{" "}
              ·{" "}
              {new Date(m.timestamp).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
            <div className="chat-body">{m.body}</div>
          </div>
        ))}
        {messages.length === 0 && <span className="muted small">No messages yet.</span>}
      </div>

      {canSend ? (
        <div className="composer">
          {error && (
            <div className="badge badge-bad" style={{ display: "block", marginBottom: 8 }}>
              {error}
            </div>
          )}
          <div className="row" style={{ marginBottom: 6, flexWrap: "wrap" }}>
            <select
              className="select select-inline"
              value=""
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                if (t) setBody(t.body);
              }}
            >
              <option value="">Use a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                  {t.scope === "personal" ? " (personal)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setManagingTemplates(!managingTemplates)}
            >
              {managingTemplates ? "Done" : "My templates"}
            </button>
          </div>

          {managingTemplates && <PersonalTemplates templates={templates} />}

          <div className="row">
            <textarea
              className="textarea"
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                navigator.onLine ? "Message…" : "Sending needs connectivity"
              }
              disabled={!navigator.onLine}
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!body.trim() || sending || !navigator.onLine}
              onClick={() => void send()}
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
          {!navigator.onLine && (
            <p className="muted small" style={{ marginTop: 4 }}>
              History is readable offline, but SMS goes out through Twilio, so
              sending needs a connection — it isn't silently queued.
            </p>
          )}
        </div>
      ) : (
        <p className="muted small">
          You can read this thread but not send — sending needs{" "}
          <code>place_calls</code>.
        </p>
      )}
    </div>
  );
}

function PersonalTemplates({ templates }: { templates: SmsTemplateRow[] }) {
  const current = useCurrent();
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");
  const mine = templates.filter((t) => t.scope === "personal");

  const add = async () => {
    if (!label.trim() || !body.trim() || !current.user) return;
    await createSmsTemplate({
      label: label.trim(),
      body: body.trim(),
      scope: "personal",
      ownerId: current.user.id,
    });
    setLabel("");
    setBody("");
  };

  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div className="stack" style={{ gap: 4, marginBottom: 8 }}>
        {mine.map((t) => (
          <div key={t.id} className="spread small">
            <span>
              <strong>{t.label}</strong> — {t.body}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => void deleteSmsTemplate(t.id)}
            >
              Remove
            </button>
          </div>
        ))}
        {mine.length === 0 && (
          <span className="muted small">
            No personal templates. Global ones are managed in Admin.
          </span>
        )}
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <input
          className="input select-inline"
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <input
          className="input select-inline"
          placeholder="Message body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={!label.trim() || !body.trim()}
          onClick={() => void add()}
        >
          Add
        </button>
      </div>
    </div>
  );
}
