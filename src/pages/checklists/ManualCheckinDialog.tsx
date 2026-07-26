import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../lib/db";
import { distanceMeters } from "../../lib/geo";
import { useCheckpointVisit } from "./useCheckpointVisit";

// Checklists & Tours — Manual Check-In Dialog (see pages/manual-checkin-dialog.html).
// Fallback when a checkpoint's NFC tag/QR is unreadable. Reason is the one
// hard validation rule; GPS is still captured in the background exactly as
// on the scanned flow.
export function ManualCheckinDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [checkpointId, setCheckpointId] = useState("");
  const [reason, setReason] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data } = db.useQuery({ checkpoints: { location: {} } });

  // Nearest first when the device will say where it is — this dialog gets
  // used in the field, standing at the checkpoint whose tag won't scan.
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      // No location is fine — the full list is the documented fallback.
      () => setHere(null),
      { timeout: 10_000 },
    );
  }, []);

  const checkpoints = useMemo(() => {
    const all = [...(data?.checkpoints ?? [])];
    if (!here) {
      return all.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      );
    }
    const distanceOf = (cp: (typeof all)[number]) =>
      cp.gpsLat != null && cp.gpsLng != null
        ? distanceMeters(here.lat, here.lng, cp.gpsLat, cp.gpsLng)
        : Number.POSITIVE_INFINITY;
    return all
      .map((cp) => ({ cp, d: distanceOf(cp) }))
      .sort((a, b) => a.d - b.d || a.cp.name.localeCompare(b.cp.name))
      .map(({ cp, d }) => ({ ...cp, distance: d }));
  }, [data, here]);

  const visit = useCheckpointVisit(
    submitted ? checkpointId : undefined,
    "manual",
    reason,
    undefined,
  );

  const open = (id: string) => {
    onClose();
    navigate(`/checklists/${id}`);
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Manual Check-In
        </div>

        {!submitted ? (
          <>
            <div className="field">
              <span className="field-label">Checkpoint</span>
              <select
                className="select"
                value={checkpointId}
                onChange={(e) => setCheckpointId(e.target.value)}
              >
                <option value="">
                  {here ? "Select — nearest first…" : "Select…"}
                </option>
                {checkpoints.map((cp) => {
                  const d = (cp as { distance?: number }).distance;
                  const near =
                    d != null && Number.isFinite(d)
                      ? ` · ${d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`} away`
                      : "";
                  return (
                    <option key={cp.id} value={cp.id}>
                      {cp.name}
                      {cp.location?.name ? ` — ${cp.location.name}` : ""}
                      {near}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="field">
              <span className="field-label">Reason — required</span>
              <textarea
                className="textarea"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. NFC tag damaged, scanning QR sticker instead"
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!checkpointId || !reason.trim()}
                onClick={() => setSubmitted(true)}
              >
                Submit
              </button>
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : visit.loading || !visit.checkInId ? (
          <div className="muted">Logging check-in…</div>
        ) : visit.applicableChecklists.length === 0 ? (
          <>
            <p className="muted small">Check-in logged. Nothing currently applies here.</p>
            <button type="button" className="btn" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <p className="muted small">Check-in logged.</p>
            <div className="stack">
              {visit.applicableChecklists.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="btn btn-block"
                  onClick={() => open(c.id)}
                >
                  {c.templateName}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
