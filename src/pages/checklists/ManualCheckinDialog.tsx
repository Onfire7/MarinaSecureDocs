import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../lib/db";
import { distanceMeters } from "../../lib/geo";
import { useCheckpointVisit } from "./useCheckpointVisit";
import { SearchPicker } from "../shared/SearchPicker";

// Checklists & Tours — Manual Check-In Dialog (see pages/manual-checkin-dialog.html).
// Fallback when a checkpoint's NFC tag/QR is unreadable. Reason is the one
// hard validation rule; GPS is still captured in the background exactly as
// on the scanned flow.
export function ManualCheckinDialog({
  initialCheckpointId,
  onClose,
}: {
  /** Preselected when opened from somewhere that already knows the
   *  checkpoint — a location's own detail page, say. Still changeable. */
  initialCheckpointId?: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [checkpointId, setCheckpointId] = useState(initialCheckpointId ?? "");
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

  const options = useMemo(
    () =>
      checkpoints.map((cp) => {
        const d = (cp as { distance?: number }).distance;
        const near =
          d != null && Number.isFinite(d)
            ? `${d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`} away`
            : "";
        const hint = [cp.location?.name, near].filter(Boolean).join(" · ");
        return { id: cp.id, name: cp.name, hint: hint || undefined };
      }),
    [checkpoints],
  );

  const visit = useCheckpointVisit(
    submitted ? checkpointId : undefined,
    "manual",
    reason,
    undefined,
  );

  const open = (instanceId: string) => {
    onClose();
    navigate(`/checklists/${instanceId}`);
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
              {/* Ordering is the picker's caller's business: nearest-first
                  when the device says where it is, alphabetical otherwise.
                  The location and distance ride along as the second line,
                  which is also what the filter matches against — "back dock
                  c" finds Back Door on Dock C. */}
              <SearchPicker
                options={options}
                value={checkpointId}
                onChange={setCheckpointId}
                placeholder={here ? "Search — nearest first…" : "Search checkpoints…"}
                emptyMessage="No checkpoints exist yet."
                autoFocus
              />
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
        ) : visit.applicableSections.length === 0 ? (
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
              {visit.applicableSections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="btn btn-block"
                  onClick={() => open(s.instanceId)}
                >
                  {s.checklistName}
                  {s.label !== s.checklistName ? ` — ${s.label}` : ""}
                  {s.itemsTotal > 0 ? ` (${s.itemsDone}/${s.itemsTotal})` : ""}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
