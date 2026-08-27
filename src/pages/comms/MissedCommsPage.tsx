import { useState } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { formatPhone } from "../../lib/comms";
import { NewCallDialog } from "./NewCommsDialogs";
import { useMissedCalls, useSmsThreads } from "../../data/comms";
import { useMarinaSettings } from "../../data/settings";

// Comms — Missed Calls / Unread SMS Detail (see
// docs/pages/missed-comms-detail.html). A combined catch-up worklist, not a
// permanent home for history. Its two halves are gated independently.
export function MissedCommsPage() {
  const current = useCurrent();
  const canCalls = current.can("view_calls");
  const canSms = current.can("view_sms");
  const canPlace = current.can("place_calls");
  const [callingBack, setCallingBack] = useState(false);

  const settings = useMarinaSettings();
  const { data: calls } = useMissedCalls();
  const { data: threads } = useSmsThreads();
  const missedCalls = canCalls ? calls : [];
  const unreadThreads = canSms ? threads.filter((t) => t.unread === 1) : [];

  if (!canCalls && !canSms) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Missed &amp; unread</h1>
          <div className="page-sub">
            <Link to="/comms">← Comms</Link>
          </div>
        </div>
      </div>

      <div className="grid-2">
        {canCalls && (
          <div>
            <div className="section-title">Missed calls ({missedCalls.length})</div>
            <div className="stack" style={{ gap: 6 }}>
              {missedCalls.map((c) => (
                <div key={c.id} className="card">
                  <div className="spread" style={{ flexWrap: "wrap" }}>
                    <div>
                      <div className="card-title">
                        {c.contact_name ?? formatPhone(c.from_number)}
                      </div>
                      <div className="card-meta">
                        {c.line ? `${c.line} · ` : ""}
                        {c.started_at
                          ? new Date(c.started_at).toLocaleString(undefined, {
                              month: "short",
                              day: "numeric",
                              hour: "numeric",
                              minute: "2-digit",
                            })
                          : ""}
                      </div>
                    </div>
                    {canPlace && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => setCallingBack(true)}
                      >
                        Call back
                      </button>
                    )}
                  </div>
                  {/* Voicemail plays inline; recording/transcript sections are
                      omitted entirely when the marina has them disabled. */}
                  {c.voicemail_url && (
                    <audio
                      controls
                      src={c.voicemail_url}
                      style={{ width: "100%", marginTop: 6 }}
                    />
                  )}
                  {settings.callTranscriptionEnabled && c.transcript && (
                    <p className="small" style={{ whiteSpace: "pre-wrap" }}>
                      {c.transcript}
                    </p>
                  )}
                </div>
              ))}
              {missedCalls.length === 0 && (
                <span className="muted small">Nothing missed.</span>
              )}
            </div>
          </div>
        )}

        {canSms && (
          <div>
            <div className="section-title">Unread texts ({unreadThreads.length})</div>
            <div className="stack" style={{ gap: 6 }}>
              {unreadThreads.map((t) => (
                <Link
                  key={t.id}
                  to={`/comms/sms/${t.id}`}
                  className="card spread"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <span>
                    <span className="card-title">{t.contact_name ?? "Unknown"}</span>
                    <span className="card-meta">{t.line ?? ""}</span>
                  </span>
                  <span className="badge badge-accent">Unread</span>
                </Link>
              ))}
              {unreadThreads.length === 0 && (
                <span className="muted small">Nothing unread.</span>
              )}
            </div>
          </div>
        )}
      </div>

      {callingBack && <NewCallDialog onClose={() => setCallingBack(false)} />}
    </div>
  );
}
