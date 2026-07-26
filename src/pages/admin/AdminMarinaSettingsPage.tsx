import { useState } from "react";
import { db, id } from "../../lib/db";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";

// Admin — Marina Settings (see docs/pages/admin-marina-settings.html).
// Exactly one MarinaSettings record per marina, not a list. Every edit takes
// effect immediately — no publish/staging step.
export function AdminMarinaSettingsPage() {
  return (
    <AdminGate requires="manage_marina_settings">
      <MarinaSettings />
    </AdminGate>
  );
}

type PhoneLine = { number: string; label: string; routing?: Record<string, unknown> };

function MarinaSettings() {
  const { data, isLoading } = db.useQuery({ marinaSettings: {} });
  const settings = data?.marinaSettings?.[0];
  const [recipientDraft, setRecipientDraft] = useState("");
  const [lineDraft, setLineDraft] = useState({ number: "", label: "" });

  if (isLoading) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  // A brand-new marina has no settings row yet; create it with the documented
  // defaults rather than erroring.
  if (!settings) {
    const create = () =>
      void db.transact(
        db.tx.marinaSettings[id()].update({
          gpsValidationRadiusDefault: 50,
          activityLogRetentionDays: 365,
          callRecordingEnabled: false,
          callTranscriptionEnabled: false,
          shiftReportRecipients: [],
          allowOverlappingReservations: false,
          haulOutMode: "ask",
        }),
      );
    return (
      <div>
        <AdminHeader title="Marina Settings" />
        <div className="placeholder">
          <div className="big">No settings record yet</div>
          <button type="button" className="btn btn-primary" onClick={create}>
            Create marina settings
          </button>
        </div>
      </div>
    );
  }

  const update = (fields: Record<string, unknown>) =>
    void db.transact(db.tx.marinaSettings[settings.id].update(fields));

  const recipients = settings.shiftReportRecipients ?? [];
  const lines = (settings.phoneLines ?? []) as PhoneLine[];

  const addRecipient = () => {
    const email = recipientDraft.trim();
    if (!email) return;
    update({ shiftReportRecipients: [...recipients, email] });
    setRecipientDraft("");
  };

  const addLine = () => {
    if (!lineDraft.number.trim()) return;
    update({
      phoneLines: [
        ...lines,
        { number: lineDraft.number.trim(), label: lineDraft.label.trim() },
      ],
    });
    setLineDraft({ number: "", label: "" });
  };

  const removeLine = (index: number) => {
    if (lines.length === 1) {
      const ok = window.confirm(
        "This is the marina's only phone line. Removing it leaves calling and texting with no number to route through — continue?",
      );
      if (!ok) return;
    }
    update({ phoneLines: lines.filter((_, i) => i !== index) });
  };

  return (
    <div>
      <AdminHeader title="Marina Settings" />

      <div className="grid-2">
        <div>
          <div className="field">
            <span className="field-label">Marina name</span>
            <input
              className="input"
              value={settings.marinaName ?? ""}
              onChange={(e) => update({ marinaName: e.target.value })}
            />
          </div>

          <div className="field">
            <span className="field-label">GPS validation radius default (meters)</span>
            <input
              type="number"
              className="input select-inline"
              value={settings.gpsValidationRadiusDefault}
              onChange={(e) =>
                update({ gpsValidationRadiusDefault: Number(e.target.value) })
              }
            />
            <p className="muted small" style={{ marginTop: 4 }}>
              Used by any checkpoint without its own override.
            </p>
          </div>

          <div className="field">
            <span className="field-label">Activity Log retention (days)</span>
            <input
              type="number"
              className="input select-inline"
              value={settings.activityLogRetentionDays}
              onChange={(e) =>
                update({ activityLogRetentionDays: Number(e.target.value) })
              }
            />
            <p className="muted small" style={{ marginTop: 4 }}>
              Applies at the next scheduled purge, not retroactively. Entries
              flagged Protected are never purged.
            </p>
          </div>

          <div className="field">
            <span className="field-label">Calls</span>
            <label className="row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.callRecordingEnabled}
                onChange={(e) => update({ callRecordingEnabled: e.target.checked })}
              />
              <span className="small">Record calls</span>
            </label>
            <label className="row" style={{ cursor: "pointer", marginTop: 4 }}>
              <input
                type="checkbox"
                checked={settings.callTranscriptionEnabled}
                onChange={(e) => update({ callTranscriptionEnabled: e.target.checked })}
              />
              <span className="small">Transcribe calls</span>
            </label>
          </div>

          <div className="field">
            <span className="field-label">Reservations</span>
            <label className="row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={settings.allowOverlappingReservations}
                onChange={(e) =>
                  update({ allowOverlappingReservations: e.target.checked })
                }
              />
              <span className="small">
                Allow overlapping reservations on the same target
              </span>
            </label>
          </div>

          <div className="field">
            <span className="field-label">Haul-out mode</span>
            <select
              className="select select-inline"
              value={settings.haulOutMode ?? "ask"}
              onChange={(e) => update({ haulOutMode: e.target.value })}
            >
              <option value="ask">Ask who performed it</option>
              <option value="customer">Always assume customer</option>
            </select>
            <p className="muted small" style={{ marginTop: 4 }}>
              Marina haul-outs raise a ticket for the work; customer ones don't.
            </p>
          </div>
        </div>

        <div>
          <div className="field">
            <span className="field-label">Shift report recipients</span>
            {/* Surfaced here and only here — a nudge at the one place it's
                actually configured, never a banner elsewhere. */}
            {recipients.length === 0 && (
              <div className="badge badge-warn" style={{ display: "block", marginBottom: 6 }}>
                No recipients — shift reports will compile but have nowhere to go.
              </div>
            )}
            <div className="stack" style={{ gap: 4, marginBottom: 6 }}>
              {recipients.map((email, i) => (
                <div key={`${email}-${i}`} className="card spread">
                  <span className="small">{email}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() =>
                      update({
                        shiftReportRecipients: recipients.filter((_, x) => x !== i),
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="row">
              <input
                className="input select-inline"
                placeholder="name@example.com"
                value={recipientDraft}
                onChange={(e) => setRecipientDraft(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={!recipientDraft.trim()}
                onClick={addRecipient}
              >
                Add
              </button>
            </div>
          </div>

          <div className="field">
            <span className="field-label">Phone lines</span>
            <div className="stack" style={{ gap: 4, marginBottom: 6 }}>
              {lines.map((line, i) => (
                <div key={`${line.number}-${i}`} className="card spread">
                  <span className="small">
                    <strong>{line.number}</strong>
                    {line.label ? ` · ${line.label}` : ""}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => removeLine(i)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              {lines.length === 0 && (
                <span className="muted small">No lines configured.</span>
              )}
            </div>
            <div className="row">
              <input
                className="input select-inline"
                placeholder="+15555550123"
                value={lineDraft.number}
                onChange={(e) => setLineDraft({ ...lineDraft, number: e.target.value })}
              />
              <input
                className="input select-inline"
                placeholder="Label"
                value={lineDraft.label}
                onChange={(e) => setLineDraft({ ...lineDraft, label: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={!lineDraft.number.trim()}
                onClick={addLine}
              >
                Add
              </button>
            </div>
            <p className="muted small" style={{ marginTop: 4 }}>
              The number must already exist on the marina's Twilio account — this
              records it for the app, it doesn't provision it.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
