import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { displayName } from "../../lib/contacts";
import { twilioRequest, type PhoneLine } from "../../lib/comms";

// Comms — New Call Dialog and New SMS Dialog (see
// docs/pages/new-call-dialog.html, new-sms-dialog.html).
// Both are thin: collect who and which line, then hand off to the Twilio
// Functions bridge, which places the call/text and writes the resulting
// records itself. Both are gated by place_calls and are online-only.

function useCommsTargets() {
  const { data } = db.useQuery({
    contacts: { mergedInto: {} },
    marinaSettings: {},
    smsThreads: { contact: {} },
  });
  const contacts = [...(data?.contacts ?? [])]
    .filter((c) => !c.mergedInto)
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));
  const lines = (data?.marinaSettings?.[0]?.phoneLines ?? []) as PhoneLine[];
  return { contacts, lines, threads: data?.smsThreads ?? [] };
}

export function NewCallDialog({ onClose }: { onClose: () => void }) {
  const current = useCurrent();
  const { contacts, lines } = useCommsTargets();
  const [contactId, setContactId] = useState("");
  const [manualNumber, setManualNumber] = useState("");
  const [line, setLine] = useState(lines[0]?.number ?? "");
  const [error, setError] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);

  if (!current.can("place_calls")) return null;

  const contact = contacts.find((c) => c.id === contactId);
  const target = manualNumber.trim() || contact?.phone || "";
  const offline = !navigator.onLine;

  const call = async () => {
    setCalling(true);
    setError(null);
    try {
      await twilioRequest("/calls/initiate", {
        to: target,
        contactId: contactId || undefined,
        line,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Call failed.");
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          New call
        </div>

        <div className="field">
          <span className="field-label">Contact</span>
          <select
            className="select"
            value={contactId}
            onChange={(e) => {
              setContactId(e.target.value);
              setManualNumber("");
            }}
          >
            <option value="">Select a contact…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {displayName(c)}
                {c.phone ? ` — ${c.phone}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <span className="field-label">…or dial a number</span>
          <input
            className="input"
            value={manualNumber}
            onChange={(e) => {
              setManualNumber(e.target.value);
              setContactId("");
            }}
            placeholder="+15555550123"
            inputMode="tel"
          />
        </div>

        <LinePicker lines={lines} line={line} setLine={setLine} />

        {error && (
          <div className="badge badge-bad" style={{ display: "block", marginBottom: 8 }}>
            {error}
          </div>
        )}
        {offline && (
          <p className="muted small">
            Calling runs through Twilio, so it needs a connection.
          </p>
        )}

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!target || calling || offline}
            onClick={() => void call()}
          >
            {calling ? "Connecting…" : "Call"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function NewSmsDialog({ onClose }: { onClose: () => void }) {
  const current = useCurrent();
  const navigate = useNavigate();
  const { contacts, lines, threads } = useCommsTargets();
  const [contactId, setContactId] = useState("");
  const [manualNumber, setManualNumber] = useState("");
  const [line, setLine] = useState(lines[0]?.number ?? "");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (!current.can("place_calls")) return null;

  const contact = contacts.find((c) => c.id === contactId);
  const target = manualNumber.trim() || contact?.phone || "";
  const offline = !navigator.onLine;

  // A thread is identified by contact + line, so an existing pairing is
  // routed into rather than duplicated.
  const existing = threads.find(
    (t) => t.contact?.id === contactId && t.line === line,
  );

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await twilioRequest("/sms/send", {
        to: target,
        contactId: contactId || undefined,
        line,
        body: body.trim(),
      });
      onClose();
      if (existing) navigate(`/comms/sms/${existing.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          New text
        </div>

        <div className="field">
          <span className="field-label">Contact</span>
          <select
            className="select"
            value={contactId}
            onChange={(e) => {
              setContactId(e.target.value);
              setManualNumber("");
            }}
          >
            <option value="">Select a contact…</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {displayName(c)}
                {c.phone ? ` — ${c.phone}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <span className="field-label">…or a number</span>
          <input
            className="input"
            value={manualNumber}
            onChange={(e) => {
              setManualNumber(e.target.value);
              setContactId("");
            }}
            placeholder="+15555550123"
            inputMode="tel"
          />
        </div>

        <LinePicker lines={lines} line={line} setLine={setLine} />

        {existing && (
          <p className="muted small">
            This contact already has a thread on that line — sending continues
            it rather than starting a second one.
          </p>
        )}

        <div className="field">
          <span className="field-label">Message</span>
          <textarea
            className="textarea"
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        {error && (
          <div className="badge badge-bad" style={{ display: "block", marginBottom: 8 }}>
            {error}
          </div>
        )}

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!target || !body.trim() || sending || offline}
            onClick={() => void send()}
          >
            {sending ? "Sending…" : "Send"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function LinePicker({
  lines,
  line,
  setLine,
}: {
  lines: PhoneLine[];
  line: string;
  setLine: (v: string) => void;
}) {
  if (lines.length === 0) {
    return (
      <div className="badge badge-warn" style={{ display: "block", marginBottom: 8 }}>
        No phone lines configured — set one up in Admin → Marina Settings.
      </div>
    );
  }
  // With exactly one line there's no meaningful choice to present.
  if (lines.length === 1) {
    return (
      <div className="field">
        <span className="field-label">From</span>
        <div className="field-value small">
          {lines[0].label || lines[0].number}
        </div>
      </div>
    );
  }
  return (
    <div className="field">
      <span className="field-label">From which line</span>
      <select className="select" value={line} onChange={(e) => setLine(e.target.value)}>
        {lines.map((l) => (
          <option key={l.number} value={l.number}>
            {l.label ? `${l.label} — ${l.number}` : l.number}
          </option>
        ))}
      </select>
    </div>
  );
}
