import { useState } from "react";
import {
  createPhoneLine,
  deletePhoneLine,
  saveMarinaSettings,
  useMarinaSettings,
  usePhoneLines,
} from "../../data/settings";
import { AdminGate } from "./AdminGate";
import { DraftInput, DraftNumberInput } from "../shared/DraftInput";
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

function MarinaSettings() {
  // The settings row exists from the first migration — this is a singleton
  // table with a fixed id, so there is no "create it" branch to write any more.
  // useMarinaSettings falls back to the documented defaults until it syncs.
  const settings = useMarinaSettings();
  const { lines } = usePhoneLines();
  const [recipientDraft, setRecipientDraft] = useState("");
  const [lineDraft, setLineDraft] = useState({ number: "", label: "" });

  const update = (fields: Parameters<typeof saveMarinaSettings>[1]) =>
    void saveMarinaSettings(settings.id, fields);

  const recipients = settings.shiftReportRecipients;

  const addRecipient = () => {
    const email = recipientDraft.trim();
    if (!email) return;
    update({ shiftReportRecipients: [...recipients, email] });
    setRecipientDraft("");
  };

  // Phone lines are their own table now, not a json array on settings — so
  // adding one is a row, and two people adding lines at once no longer
  // overwrite each other.
  const addLine = () => {
    if (!lineDraft.number.trim()) return;
    void createPhoneLine({
      number: lineDraft.number.trim(),
      label: lineDraft.label.trim(),
    });
    setLineDraft({ number: "", label: "" });
  };

  const removeLine = (lineId: string) => {
    if (lines.length === 1) {
      const ok = window.confirm(
        "This is the marina's only phone line. Removing it leaves calling and texting with no number to route through — continue?",
      );
      if (!ok) return;
    }
    void deletePhoneLine(lineId);
  };

  return (
    <div>
      <AdminHeader title="Marina Settings" />

      <div className="grid-2">
        <div>
          <div className="field">
            <span className="field-label">Marina name</span>
            <DraftInput
              className="input"
              aria-label="Marina name"
              value={settings.marinaName}
              onCommit={(marinaName) => update({ marinaName })}
            />
          </div>

          <div className="field">
            <span className="field-label">GPS validation radius default (meters)</span>
            <DraftNumberInput
              className="input select-inline"
              aria-label="GPS validation radius default"
              value={settings.gpsValidationRadiusDefault}
              // Required, so a cleared box is ignored rather than written as
              // undefined (which would silently drop the key and keep the old
              // value anyway, just less obviously).
              onCommit={(next) => next != null && update({ gpsValidationRadiusDefault: next })}
            />
            <p className="muted small" style={{ marginTop: 4 }}>
              Used by any checkpoint without its own override.
            </p>
          </div>

          <div className="field">
            <span className="field-label">Activity Log retention (days)</span>
            <DraftNumberInput
              className="input select-inline"
              aria-label="Activity Log retention days"
              value={settings.activityLogRetentionDays}
              // Required, so a cleared box is ignored rather than written as
              // undefined (which would silently drop the key and keep the old
              // value anyway, just less obviously).
              onCommit={(next) => next != null && update({ activityLogRetentionDays: next })}
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
              value={settings.haulOutMode}
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
              {lines.map((line) => (
                <div key={line.id} className="card spread">
                  <span className="small">
                    <strong>{line.number}</strong>
                    {line.label ? ` · ${line.label}` : ""}
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => removeLine(line.id)}
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
