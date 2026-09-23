import { useCurrent } from "../../lib/auth/CurrentUserContext";
import {
  saveLocationAmenity,
  saveLocationAttributeValue,
  saveLocationService,
  setLocationAmenityPresent,
  setLocationServicePresent,
  useAmenities,
  useAmenityValidity,
  useAttributeValidity,
  useAttributes,
  useLocationAmenities,
  useLocationAttributes,
  useLocationServices,
  useNoteSuggestions,
  useServiceValidity,
  useServices,
} from "../../data/services";
import { DraftInput, DraftNumberInput } from "../shared/DraftInput";

// A location's Services, Amenities and Attributes (docs/audits.md
// § Services, Amenities and Attributes). Everyone sees what is here;
// manage_locations edits presence, working, metered, notes and values
// directly — the admin path that does not need an audit's approval. An
// Attribute is always applicable to a valid type — there is no presence to
// toggle, only a value, optional and clearable. Once an audit exists for
// this location, an Attribute's value only changes through an approved
// Proposal (docs/audits.md), never from here mid-audit and never from a
// Finding directly — this panel is the "before any audit" and "manager
// correcting a mistake" path.
export function LocationServicesPanel({ locationId, typeId }: { locationId: string; typeId: string }) {
  const current = useCurrent();
  const canEdit = current.can("manage_locations");
  const { data: services } = useServices();
  const { data: amenities } = useAmenities();
  const { data: attributes } = useAttributes();
  const { data: sv } = useServiceValidity();
  const { data: av } = useAmenityValidity();
  const { data: atv } = useAttributeValidity();
  const { data: here } = useLocationServices(locationId);
  const { data: hereA } = useLocationAmenities(locationId);
  const { data: hereAt } = useLocationAttributes(locationId);
  const validServices = services.filter((s) => sv.some((v) => v.service_id === s.id && v.location_type_id === typeId));
  const validAmenities = amenities.filter((a) => av.some((v) => v.amenity_id === a.id && v.location_type_id === typeId));
  const validAttributes = attributes.filter((a) => atv.some((v) => v.attribute_id === a.id && v.location_type_id === typeId));
  if (validServices.length === 0 && validAmenities.length === 0 && validAttributes.length === 0) return null;
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
                    <span className={row ? undefined : "muted"}>{row ? "✓" : "-"} {s.name}</span>
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
                    <span className={row ? undefined : "muted"}>{row ? "✓" : "-"} {a.name}</span>
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
      {validAttributes.length > 0 && (
        <div className="field">
          <span className="field-label">Attributes</span>
          <div className="field-value stack" style={{ gap: 4 }}>
            {/* Always applicable to a valid type — never toggled on or off.
                Only the value is optional; leaving it blank clears it. */}
            {validAttributes.map((a) => {
              const row = hereAt.find((r) => r.attribute_id === a.id);
              return (
                <div key={a.id} className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span>{a.name}</span>
                  {canEdit ? (
                    <>
                      <DraftNumberInput
                        className="input select-inline"
                        style={{ width: 90 }}
                        placeholder="none"
                        value={row?.value ?? null}
                        onCommit={(value) => void saveLocationAttributeValue(locationId, a.id, value ?? null, row?.note ?? null)}
                      />
                      {a.unit && <span className="muted small">{a.unit}</span>}
                      <ServiceNote
                        kind="attribute"
                        entryId={a.id}
                        value={row?.note ?? ""}
                        onCommit={(note) => row && void saveLocationAttributeValue(locationId, a.id, row.value, note || null)}
                      />
                    </>
                  ) : row ? (
                    <span className="muted small">
                      {row.value}
                      {a.unit ? ` ${a.unit}` : ""}
                      {row.note ? ` — ${row.note}` : ""}
                    </span>
                  ) : (
                    <span className="muted small">none set</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function ServiceNote({ kind, entryId, value, onCommit }: { kind: "service" | "amenity" | "attribute"; entryId: string; value: string; onCommit: (v: string) => void }) {
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
