import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { ManualCheckinDialog } from "../checklists/ManualCheckinDialog";
import { useCheckpoint, useToursForCheckpoint } from "../../data/checkpoints";
import { useSectionsForCheckpoint } from "../../data/checklists";
import { useRecentCheckIns } from "../../data/checkins";
import { useMarinaSettings } from "../../data/settings";

// Locations — Checkpoint Detail (see pages/checkpoint-detail.html).
// Read-oriented reference/audit view: identity, GUID URL, GPS validation
// setup, applicable templates, tours, and recent check-in history. Editing
// happens in Admin → Locations, not here.
export function CheckpointDetailPage() {
  const { id: checkpointId } = useParams();
  const current = useCurrent();
  const [checkingIn, setCheckingIn] = useState(false);

  const { checkpoint } = useCheckpoint(checkpointId);
  const { data: sections } = useSectionsForCheckpoint(checkpointId);
  const { data: tours } = useToursForCheckpoint(checkpointId);
  const { data: checkIns } = useRecentCheckIns(checkpointId, 10);
  const settings = useMarinaSettings();

  if (!checkpoint) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const radius =
    checkpoint.gps_validation_radius ?? settings.gpsValidationRadiusDefault;
  const overridden = checkpoint.gps_validation_radius != null;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{checkpoint.name}</h1>
          {checkpoint.location_id && (
            <div className="page-sub">
              <Link to={`/locations/${checkpoint.location_id}`}>
                {checkpoint.location_name}
              </Link>
            </div>
          )}
        </div>
        <div className="row">
          {/* The page you land on from anywhere that lists a checkpoint —
              a tour on the Checklists screen, a location, a search. Standing
              at one whose tag won't read, this is where you already are. */}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setCheckingIn(true)}
          >
            Check in manually
          </button>
          {current.can("manage_locations") && (
            <Link to="/admin" className="btn btn-sm btn-quiet">
              Edit in Admin
            </Link>
          )}
        </div>
      </div>

      {checkingIn && (
        <ManualCheckinDialog
          initialCheckpointId={checkpoint.id}
          onClose={() => setCheckingIn(false)}
        />
      )}

      <div className="grid-2">
        <div>
          {current.can("manage_locations") && (
            <div className="field">
              <span className="field-label">GPS validation radius</span>
              <div className="field-value">
                {radius != null ? `${radius} m` : "—"}{" "}
                <span className={overridden ? "badge badge-accent" : "badge"}>
                  {overridden ? "Overrides marina default" : "Marina default"}
                </span>
              </div>
              {checkpoint.gps_lat != null && checkpoint.gps_lng != null ? (
                <p className="muted small" style={{ marginTop: 4 }}>
                  Anchored at {checkpoint.gps_lat.toFixed(5)},{" "}
                  {checkpoint.gps_lng.toFixed(5)}
                </p>
              ) : (
                <p className="muted small" style={{ marginTop: 4 }}>
                  No coordinates set — check-ins here are never radius-flagged.
                </p>
              )}
            </div>
          )}

          <div className="section-title">Checklist sections here</div>
          <div className="stack" style={{ gap: 8, marginBottom: 16 }}>
            {sections.map((s) => (
              <div key={s.id} className="card spread">
                <div>
                  <div className="card-title">{s.template_name ?? "Checklist"}</div>
                  <div className="card-meta">
                    {s.name}
                    {s.hide_until_rule ? ` · shows at ${s.hide_until_rule}` : ""}
                  </div>
                </div>
                {s.is_active === 0 && <span className="badge">Inactive</span>}
              </div>
            ))}
            {sections.length === 0 && (
              <span className="muted small">
                None configured — a user can still check in and add a note or incident.
              </span>
            )}
          </div>

          <div className="section-title">Tours</div>
          <div className="stack" style={{ gap: 8 }}>
            {tours.map((t) => (
              <Link
                key={t.id}
                to="/checklists"
                className="card spread"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <span className="card-title">{t.name}</span>
                <span className="badge">
                  {t.mode.charAt(0).toUpperCase() + t.mode.slice(1)}
                </span>
              </Link>
            ))}
            {tours.length === 0 && (
              <span className="muted small">Not part of any tour.</span>
            )}
          </div>
        </div>

        <div>
          <div className="section-title spread">
            <span>Recent check-ins</span>
            <Link to="/activity?subjectType=check_ins" className="small">
              Full history →
            </Link>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Guard</th>
                <th>Time</th>
                <th>Method</th>
                <th>GPS</th>
              </tr>
            </thead>
            <tbody>
              {checkIns.map((c) => (
                <tr key={c.id}>
                  <td>{c.user_name ?? "—"}</td>
                  <td className="small">
                    {new Date(c.timestamp).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td>{c.method === "scanned" ? "Scanned" : "Manual"}</td>
                  <td>
                    {c.within_radius === 1 && (
                      <span className="badge badge-good">OK</span>
                    )}
                    {c.within_radius === 0 && (
                      <span className="badge badge-bad">Outside radius</span>
                    )}
                    {c.within_radius == null && <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {checkIns.length === 0 && (
            <div className="placeholder" style={{ marginTop: 8 }}>
              <div className="big">No check-ins yet</div>
              This checkpoint hasn't been visited.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
