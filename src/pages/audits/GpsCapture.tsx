// GPS capture (docs/audits.md § GPS capture), shared by the Finding form and
// the wizard. Watches the device's position, compares it with the pin on
// file through gpsPrompt(), and offers to capture a fix - only when the
// accuracy is within the marina's limit and the auditor has said they are
// standing at the location. A capture is a set_gps Proposal, never a write.
//
// The Finding form shows this only when there is something to say: no pin,
// or the device is farther from it than the audit GPS radius. The wizard
// shows it always (`always`), because a page in a run cannot be
// conditionally empty, and because an auditor standing at a pinned location
// may know the pin is wrong when the device does not.
import { useState } from "react";
import { gpsPrompt } from "../../lib/audits";
import { useDevicePosition } from "../shared/useDevicePosition";

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy: number;
}

export function GpsCapture({
  locationName,
  pin,
  radius,
  accuracyLimit,
  captured,
  editable,
  onCapture,
  always,
  big,
}: {
  locationName: string;
  pin: { lat: number; lng: number } | null;
  radius: number;
  accuracyLimit: number;
  captured: GpsFix | null;
  editable: boolean;
  onCapture: (fix: GpsFix | null) => void;
  /** Show even when the pin on file agrees with the device. */
  always?: boolean;
  /** The wizard's one-item-per-screen size. */
  big?: boolean;
}) {
  const device = useDevicePosition();
  const [standing, setStanding] = useState(false);
  const decision = gpsPrompt({ location: pin, device, radius, accuracyLimit });
  if (!always && !decision.prompt && !captured) return null;

  const status =
    decision.reason === "missing"
      ? `${locationName} has no coordinates yet.`
      : decision.distanceMeters === null
        ? `${locationName} is pinned at ${pin!.lat.toFixed(5)}, ${pin!.lng.toFixed(5)}.`
        : decision.reason === "far"
          ? `You are ${Math.round(decision.distanceMeters)} m from where ${locationName} is pinned.`
          : `You are ${Math.round(decision.distanceMeters)} m from the pin, within the ${radius} m the marina allows.`;
  const body = (
    <>
      {captured ? (
        <div className="row" style={{ alignItems: "center", gap: 8, justifyContent: big ? "center" : undefined, flexWrap: "wrap" }}>
          <span className="badge badge-good" data-testid="gps-captured">
            Coordinates captured (±{Math.round(captured.accuracy)} m) - waits for approval
          </span>
          {editable && (
            <button type="button" className="btn btn-sm btn-bare" onClick={() => onCapture(null)}>
              discard
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="muted small" style={{ marginBottom: 6 }}>
            {status}
            {!decision.captureEnabled && decision.accuracyMeters !== null && ` GPS accuracy ${Math.round(decision.accuracyMeters)} m - move into the open and try again.`}
          </div>
          <label style={{ display: "block", marginBottom: 6 }}>
            <input type="checkbox" checked={standing} disabled={!editable} onChange={(e) => setStanding(e.target.checked)} data-testid="gps-standing" /> I am
            standing directly at {locationName}
          </label>
          <button
            type="button"
            className={`btn btn-primary ${big ? "wz-btn-big" : "btn-sm"}`}
            disabled={!editable || !standing || !decision.captureEnabled || !device}
            onClick={() => device && onCapture(device)}
            data-testid="gps-capture"
          >
            Use my position
          </button>
        </>
      )}
    </>
  );
  const accuracy = decision.accuracyMeters !== null ? `accuracy ${Math.round(decision.accuracyMeters)} m` : "no fix yet";
  if (big)
    return (
      <div style={{ width: "100%", maxWidth: 360 }}>
        <div className="muted small" style={{ marginBottom: 6 }}>
          {accuracy}
        </div>
        {body}
      </div>
    );
  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: "4px solid var(--accent)" }}>
      <div className="card-kicker">
        <span>GPS</span>
        <span>{accuracy}</span>
      </div>
      {body}
    </div>
  );
}
