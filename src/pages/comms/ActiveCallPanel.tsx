import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { displayName, isNameless } from "../../lib/contacts";
import { formatPhone, twilioRequest } from "../../lib/comms";

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

  const { data } = db.useQuery({
    calls: {
      $: { where: { duration: { $isNull: true }, missed: false } },
      contact: {},
    },
    marinaSettings: {},
  });

  const live = (data?.calls ?? [])
    .filter((c) => c.startedAt != null)
    .sort(
      (a, b) => new Date(b.startedAt!).getTime() - new Date(a.startedAt!).getTime(),
    )[0];

  if (!live || dismissed === live.id) return null;

  return (
    <CallPanelBody
      call={live}
      recordingEnabled={Boolean(data?.marinaSettings?.[0]?.callRecordingEnabled)}
      transcriptionEnabled={Boolean(data?.marinaSettings?.[0]?.callTranscriptionEnabled)}
      canSeeContext={current.can("view_calls")}
      canControl={current.can("place_calls")}
      onDismiss={() => setDismissed(live.id)}
    />
  );
}

type Call = {
  id: string;
  direction: string;
  line?: string;
  fromNumber?: string;
  startedAt?: string | number;
  recordingUrl?: string;
  transcript?: string;
  contact?: { id: string; name?: string | null; phone?: string | null } | null;
};

function CallPanelBody({
  call,
  recordingEnabled,
  transcriptionEnabled,
  canSeeContext,
  canControl,
  onDismiss,
}: {
  call: Call;
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

  const contactId = call.contact?.id;
  const { data } = db.useQuery(
    canSeeContext && contactId
      ? {
          reservations: {
            $: {
              where: {
                "contact.id": contactId,
                status: { $in: ["confirmed", "checked_in"] },
              },
            },
            location: {},
            asset: {},
          },
          boats: { $: { where: { "owners.id": contactId } }, currentSlip: {} },
          callNotes: { $: { where: { "call.contact.id": contactId } }, author: {} },
        }
      : null,
  );

  const elapsed = call.startedAt
    ? Math.floor((Date.now() - new Date(call.startedAt).getTime()) / 1000)
    : 0;

  const addNote = async () => {
    if (!note.trim() || !current.user) return;
    await db.transact(
      db.tx.callNotes[id()]
        .update({ body: note.trim(), createdAt: Date.now() })
        .link({ call: call.id, author: current.user.id }),
    );
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
            {canSeeContext
              ? call.contact
                ? displayName(call.contact)
                : formatPhone(call.fromNumber)
              : formatPhone(call.fromNumber)}
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
          {call.contact && isNameless(call.contact) && (
            <Link to={`/contacts/${call.contact.id}`} className="badge badge-warn">
              Unknown caller — name &amp; merge
            </Link>
          )}

          {(data?.reservations ?? []).length > 0 && (
            <div className="field">
              <span className="field-label">Active reservations</span>
              {(data?.reservations ?? []).map((r) => (
                <div key={r.id} className="small">
                  <Link to={`/reservations/${r.id}`}>
                    {r.location?.name ?? r.asset?.name ?? "Reservation"}
                  </Link>
                  {r.expectedCheckin &&
                    ` · ${new Date(r.expectedCheckin).toLocaleDateString()}`}
                </div>
              ))}
            </div>
          )}

          {current.can("view_owner") && (data?.boats ?? []).length > 0 && (
            <div className="field">
              <span className="field-label">Boats</span>
              {(data?.boats ?? []).map((b) => (
                <div key={b.id} className="small">
                  <Link to={`/boats/${b.id}`}>{b.name}</Link>
                  {b.currentSlip && ` · ${b.currentSlip.name}`}
                </div>
              ))}
            </div>
          )}

          {(data?.callNotes ?? []).length > 0 && (
            <div className="field">
              <span className="field-label">Prior notes</span>
              {(data?.callNotes ?? []).slice(0, 4).map((n) => (
                <div key={n.id} className="small">
                  {n.body}
                  <span className="muted"> — {n.author?.name ?? "—"}</span>
                </div>
              ))}
            </div>
          )}

          {recordingEnabled && call.recordingUrl && (
            <audio controls src={call.recordingUrl} style={{ width: "100%" }} />
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
