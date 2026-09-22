import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { isNameless } from "../../lib/contacts";
import { formatPhone, twilioRequest } from "../../lib/comms";
import {
  addCallNote,
  useActiveCalls,
  useCallNotes,
  type CallRow,
} from "../../data/comms";
import { useMarinaSettings } from "../../data/settings";
import { useReservationsForContact } from "../../data/reservations";
import { useContactCraft } from "../../data/boats";

// Comms — Active Call Panel (see docs/pages/active-call-panel.html).
// Mounted app-wide: it appears whenever a call is live, so whoever answers
// already has context. The panel itself isn't permission-gated — it's this
// user's own device ringing — but everything *inside* it requires view_calls.
//
// A live call is one the Twilio Function created with startedAt set and no
// duration yet; the same Function fills in duration when it ends.
export function ActiveCallPanel() {
  const current = useCurrent();
  const [dismissed, setDismissed] = useState<string | null>(null);

  const { data: activeCalls } = useActiveCalls();
  const settings = useMarinaSettings();

  const live = activeCalls.filter((c) => c.started_at != null)[0];

  if (!live || dismissed === live.id) return null;

  return (
    <CallPanelBody
      call={live}
      recordingEnabled={settings.callRecordingEnabled}
      transcriptionEnabled={settings.callTranscriptionEnabled}
      canSeeContext={current.can("view_calls")}
      canControl={current.can("place_calls")}
      onDismiss={() => setDismissed(live.id)}
    />
  );
}

function CallPanelBody({
  call,
  recordingEnabled,
  transcriptionEnabled,
  canSeeContext,
  canControl,
  onDismiss,
}: {
  call: CallRow;
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  canSeeContext: boolean;
  canControl: boolean;
  onDismiss: () => void;
}) {
  const current = useCurrent();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);

  // Live duration ticks while the call is up.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const contactId = call.contact_id ?? undefined;
  const { data: reservations } = useReservationsForContact(contactId);
  const { data: craft } = useContactCraft(contactId);
  // Notes on THIS call, not every call this contact has ever made. The old
  // query walked call → contact → all their calls' notes, which on a regular
  // caller buried the note about the call you are actually on.
  const { data: priorNotes } = useCallNotes(call.id);

  const active = reservations.filter(
    (r) => r.status === "confirmed" || r.status === "checked_in",
  );
  const boats = craft.filter((c) => c.kind === "boat");

  const elapsed = call.started_at
    ? Math.floor((Date.now() - new Date(call.started_at).getTime()) / 1000)
    : 0;

  const addNote = async () => {
    if (!note.trim() || !current.user) return;
    await addCallNote(call.id, note.trim(), current.user.id);
    setNote("");
  };

  const endCall = async () => {
    setError(null);
    try {
      // The Function hangs up and updates duration on the resulting webhook —
      // the frontend never writes that itself.
      await twilioRequest("/calls/end", { callId: call.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't end the call.");
    }
  };

  return (
    <div className="call-panel">
      <div className="spread">
        <div>
          <div className="card-kicker">
            {call.direction === "inbound" ? "Incoming call" : "Outbound call"}
          </div>
          <div className="card-title">
            {/* Contact identity requires view_calls; the raw call state
                doesn't, since it's this user's own device. */}
            {canSeeContext && call.contact_name
              ? call.contact_name
              : formatPhone(call.from_number)}
          </div>
          <div className="card-meta">
            {call.line ? `${call.line} · ` : ""}
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          </div>
        </div>
        <button type="button" className="btn btn-sm btn-quiet" onClick={onDismiss}>
          Dismiss
        </button>
      </div>

      {canSeeContext ? (
        <div style={{ marginTop: 10 }}>
          {call.contact_id && isNameless({ id: call.contact_id, name: call.contact_name }) && (
            <Link to={`/contacts/${call.contact_id}`} className="badge badge-warn">
              Unknown caller — name &amp; merge
            </Link>
          )}

          {active.length > 0 && (
            <div className="field">
              <span className="field-label">Active reservations</span>
              {active.map((r) => (
                <div key={r.id} className="small">
                  <Link to={`/reservations/${r.id}`}>
                    {r.location_name ?? r.asset_name ?? "Reservation"}
                  </Link>
                  {r.expected_checkin &&
                    ` · ${new Date(r.expected_checkin).toLocaleDateString()}`}
                </div>
              ))}
            </div>
          )}

          {current.can("view_owner") && boats.length > 0 && (
            <div className="field">
              <span className="field-label">Boats</span>
              {boats.map((b) => (
                <div key={b.id} className="small">
                  <Link to={`/boats/${b.id}`}>{b.label}</Link>
                  <span className="muted"> · {b.role}</span>
                </div>
              ))}
            </div>
          )}

          {priorNotes.length > 0 && (
            <div className="field">
              <span className="field-label">Notes on this call</span>
              {priorNotes.slice(0, 4).map((n) => (
                <div key={n.id} className="small">
                  {n.body}
                  <span className="muted"> — {n.author_name ?? "—"}</span>
                </div>
              ))}
            </div>
          )}

          {recordingEnabled && call.recording_url && (
            <audio controls src={call.recording_url} style={{ width: "100%" }} />
          )}
          {transcriptionEnabled && call.transcript && (
            <p className="small" style={{ whiteSpace: "pre-wrap" }}>
              {call.transcript}
            </p>
          )}

          <div className="field" style={{ marginBottom: 8 }}>
            <textarea
              className="textarea"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note about this call…"
            />
            <button
              type="button"
              className="btn btn-sm"
              disabled={!note.trim()}
              onClick={() => void addNote()}
            >
              Add note
            </button>
          </div>
        </div>
      ) : (
        <p className="muted small" style={{ marginTop: 8 }}>
          Call context needs <code>view_calls</code>.
        </p>
      )}

      {error && (
        <div className="badge badge-bad" style={{ display: "block", marginBottom: 8 }}>
          {error}
        </div>
      )}

      {canControl && (
        <button type="button" className="btn btn-danger btn-block" onClick={() => void endCall()}>
          End call
        </button>
      )}
    </div>
  );
}
