import { Link, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { templateAppliesNow } from "../../lib/checklists";

// Locations — Checkpoint Detail (see pages/checkpoint-detail.html).
// Read-oriented reference/audit view: identity, GUID URL, GPS validation
// setup, applicable templates, tours, and recent check-in history. Editing
// happens in Admin → Locations, not here.
export function CheckpointDetailPage() {
  const { id: checkpointId } = useParams();
  const current = useCurrent();

  const { data } = db.useQuery(
    checkpointId
      ? {
          checkpoints: {
            $: { where: { id: checkpointId } },
            location: {},
            checklistTemplates: {},
            tours: {},
          },
          marinaSettings: {},
        }
      : null,
  );
  const { data: checkInData } = db.useQuery(
    checkpointId
      ? {
          checkIns: {
            $: {
              where: { "checkpoint.id": checkpointId },
              order: { timestamp: "desc" },
              limit: 10,
            },
            user: {},
          },
        }
      : null,
  );

  const checkpoint = data?.checkpoints?.[0];
  if (!checkpoint) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const defaultRadius = data?.marinaSettings?.[0]?.gpsValidationRadiusDefault;
  const radius = checkpoint.gpsValidationRadius ?? defaultRadius;
  const overridden = checkpoint.gpsValidationRadius != null;
  const checkIns = checkInData?.checkIns ?? [];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{checkpoint.name}</h1>
          {checkpoint.location && (
            <div className="page-sub">
              <Link to={`/locations/${checkpoint.location.id}`}>
                {checkpoint.location.name}
              </Link>
            </div>
          )}
        </div>
        {current.can("manage_locations") && (
          <Link to="/admin" className="btn btn-sm btn-quiet">
            Edit in Admin
          </Link>
        )}
      </div>

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
              {checkpoint.gpsLat != null && checkpoint.gpsLng != null ? (
                <p className="muted small" style={{ marginTop: 4 }}>
                  Anchored at {checkpoint.gpsLat.toFixed(5)}, {checkpoint.gpsLng.toFixed(5)}
                </p>
              ) : (
                <p className="muted small" style={{ marginTop: 4 }}>
                  No coordinates set — check-ins here are never radius-flagged.
                </p>
              )}
            </div>
          )}

          <div className="section-title">Applicable checklist templates</div>
          <div className="stack" style={{ gap: 8, marginBottom: 16 }}>
            {(checkpoint.checklistTemplates ?? []).map((t) => {
              const cfg = (t.triggerConfig ?? {}) as { timeStart?: string; timeEnd?: string };
              return (
                <div key={t.id} className="card spread">
                  <div>
                    <div className="card-title">{t.name}</div>
                    <div className="card-meta">
                      {cfg.timeStart && cfg.timeEnd
                        ? `${cfg.timeStart} – ${cfg.timeEnd}`
                        : "Any time"}
                    </div>
                  </div>
                  {templateAppliesNow(t) && (
                    <span className="badge badge-good">Applies now</span>
                  )}
                </div>
              );
            })}
            {(checkpoint.checklistTemplates ?? []).length === 0 && (
              <span className="muted small">
                None configured — a guard can still check in and add a note or incident.
              </span>
            )}
          </div>

          <div className="section-title">Tours</div>
          <div className="stack" style={{ gap: 8 }}>
            {(checkpoint.tours ?? []).map((t) => (
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
            {(checkpoint.tours ?? []).length === 0 && (
              <span className="muted small">Not part of any tour.</span>
            )}
          </div>
        </div>

        <div>
          <div className="section-title spread">
            <span>Recent check-ins</span>
            <Link to="/activity?subjectType=checkIns" className="small">
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
                  <td>{c.user?.name ?? "—"}</td>
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
                    {c.withinRadius === true && (
                      <span className="badge badge-good">OK</span>
                    )}
                    {c.withinRadius === false && (
                      <span className="badge badge-bad">Outside radius</span>
                    )}
                    {c.withinRadius == null && <span className="muted">—</span>}
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
