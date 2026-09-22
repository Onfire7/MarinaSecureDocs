import { useCurrent } from "../../lib/auth/CurrentUserContext";
import {
  saveLocationAmenity,
  saveLocationService,
  setLocationAmenityPresent,
  setLocationServicePresent,
  useAmenities,
  useAmenityValidity,
  useLocationAmenities,
  useLocationServices,
  useNoteSuggestions,
  useServiceValidity,
  useServices,
} from "../../data/services";
import { DraftInput } from "../shared/DraftInput";

// A location's Services and Amenities (docs/audits.md § Services and
// Amenities). Everyone sees what is here; manage_locations edits presence,
// working, metered and notes directly — the admin path that does not need
// an audit's approval.
export function LocationServicesPanel({ locationId, typeId }: { locationId: string; typeId: string }) {
  const current = useCurrent();
  const canEdit = current.can("manage_locations");
  const { data: services } = useServices();
  const { data: amenities } = useAmenities();
  const { data: sv } = useServiceValidity();
  const { data: av } = useAmenityValidity();
  const { data: here } = useLocationServices(locationId);
  const { data: hereA } = useLocationAmenities(locationId);
  const validServices = services.filter((s) => sv.some((v) => v.service_id === s.id && v.location_type_id === typeId));
  const validAmenities = amenities.filter((a) => av.some((v) => v.amenity_id === a.id && v.location_type_id === typeId));
  if (validServices.length === 0 && validAmenities.length === 0) return null;
  return (
    <>
      {validServices.length > 0 && (
        <div className="field">
          <span className="field-label">Services</span>
          <div className="field-value stack" style={{ gap: 4 }}>
            {validServices.map((s) => {
              const row = here.find((r) => r.service_id === s.id);
              return (
                <div key={s.id} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {canEdit ? (
                    <label>
                      <input type="checkbox" checked={!!row} onChange={(e) => void setLocationServicePresent(locationId, s.id, e.target.checked)} /> {s.name}
                    </label>
                  ) : (
                    <span className={row ? undefined : "muted"}>{row ? "✓" : "—"} {s.name}</span>
                  )}
                  {row && (
                    <>
                      <span className={`badge ${row.working ? "badge-good" : "badge-bad"}`} onClick={() => canEdit && void saveLocationService(row.id, { working: !row.working })} style={{ cursor: canEdit ? "pointer" : undefined }}>
                        {row.working ? "working" : "not working"}
                      </span>
                      {canEdit ? (
                        <label className="muted small">
                          <input type="checkbox" checked={row.metered === 1} onChange={(e) => void saveLocationService(row.id, { metered: e.target.checked })} /> metered
                        </label>
                      ) : (
                        row.metered === 1 && <span className="muted small">metered{s.unit ? ` (${s.unit})` : ""}</span>
                      )}
                      {canEdit ? (
                        <ServiceNote kind="service" entryId={s.id} value={row.note ?? ""} onCommit={(note) => void saveLocationService(row.id, { note: note || null })} />
                      ) : (
                        row.note && <span className="muted small">{row.note}</span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {validAmenities.length > 0 && (
        <div className="field">
          <span className="field-label">Amenities</span>
          <div className="field-value stack" style={{ gap: 4 }}>
            {validAmenities.map((a) => {
              const row = hereA.find((r) => r.amenity_id === a.id);
              return (
                <div key={a.id} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  {canEdit ? (
                    <label>
                      <input type="checkbox" checked={!!row} onChange={(e) => void setLocationAmenityPresent(locationId, a.id, e.target.checked)} /> {a.name}
                    </label>
                  ) : (
                    <span className={row ? undefined : "muted"}>{row ? "✓" : "—"} {a.name}</span>
                  )}
                  {row &&
                    (canEdit ? (
                      <ServiceNote kind="amenity" entryId={a.id} value={row.note ?? ""} onCommit={(note) => void saveLocationAmenity(row.id, { note: note || null })} />
                    ) : (
                      row.note && <span className="muted small">{row.note}</span>
                    ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function ServiceNote({ kind, entryId, value, onCommit }: { kind: "service" | "amenity"; entryId: string; value: string; onCommit: (v: string) => void }) {
  const suggestions = useNoteSuggestions(kind, entryId);
  const listId = `loc-notes-${kind}-${entryId}`;
  return (
    <>
      <DraftInput className="input select-inline" list={listId} placeholder="note" value={value} onCommit={onCommit} style={{ width: 160 }} />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}
