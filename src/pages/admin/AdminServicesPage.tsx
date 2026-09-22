import { useState } from "react";
import {
  createAmenity,
  createService,
  deleteAmenity,
  deleteService,
  saveAmenity,
  saveService,
  setValidTypes,
  useAmenities,
  useAmenityValidity,
  useServiceValidity,
  useServices,
} from "../../data/services";
import { useLocationTypes } from "../../data/locations";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";
import { DraftInput } from "../shared/DraftInput";

// Admin — Services & Amenities (docs/audits.md § Services and Amenities).
// Two catalogues, each entry valid for chosen Location Types. Presence per
// location is edited on the location itself or by an approved audit
// Proposal; this screen only defines what can exist and where.
export function AdminServicesPage() {
  return (
    <AdminGate requires="manage_locations">
      <Catalogues />
    </AdminGate>
  );
}

function Catalogues() {
  const { data: services } = useServices();
  const { data: amenities } = useAmenities();
  const { data: serviceTypes } = useServiceValidity();
  const { data: amenityTypes } = useAmenityValidity();
  const { data: types } = useLocationTypes();
  const [serviceDraft, setServiceDraft] = useState({ name: "", unit: "" });
  const [amenityDraft, setAmenityDraft] = useState("");

  const typesFor = (rows: { location_type_id: string; service_id?: string; amenity_id?: string }[], id: string, key: "service_id" | "amenity_id") =>
    rows.filter((r) => r[key] === id).map((r) => r.location_type_id);

  const toggleType = (kind: "service" | "amenity", entryId: string, typeId: string, current: string[]) =>
    void setValidTypes(
      kind,
      entryId,
      current.includes(typeId) ? current.filter((t) => t !== typeId) : [...current, typeId],
    );

  const typeChips = (kind: "service" | "amenity", entryId: string, current: string[]) => (
    <div className="chip-row" style={{ marginBottom: 0 }}>
      {types.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`chip ${current.includes(t.id) ? "tree-match" : ""}`}
          onClick={() => toggleType(kind, entryId, t.id, current)}
        >
          {t.name}
        </button>
      ))}
      {types.length === 0 && <span className="muted small">No location types yet.</span>}
    </div>
  );

  return (
    <div>
      <AdminHeader title="Services & Amenities" />
      <div className="section-title">Services</div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder="New service (e.g. 30A power)"
          value={serviceDraft.name}
          onChange={(e) => setServiceDraft({ ...serviceDraft, name: e.target.value })}
        />
        <input
          className="input"
          style={{ maxWidth: 120 }}
          placeholder="Unit (kWh)"
          value={serviceDraft.unit}
          onChange={(e) => setServiceDraft({ ...serviceDraft, unit: e.target.value })}
        />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!serviceDraft.name.trim()}
          onClick={() => {
            void createService({ name: serviceDraft.name.trim(), unit: serviceDraft.unit.trim() || null });
            setServiceDraft({ name: "", unit: "" });
          }}
        >
          Add service
        </button>
      </div>
      <div className="stack" style={{ gap: 8, marginBottom: 24 }}>
        {services.map((s) => (
          <div key={s.id} className="card">
            <div className="row" style={{ alignItems: "center", marginBottom: 8 }}>
              <DraftInput className="input" style={{ maxWidth: 240 }} value={s.name} onCommit={(name) => void saveService(s.id, { name })} />
              <DraftInput
                className="input"
                style={{ maxWidth: 120 }}
                placeholder="unit"
                value={s.unit ?? ""}
                onCommit={(unit) => void saveService(s.id, { unit: unit || null })}
              />
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => window.confirm(`Delete ${s.name}?`) && void deleteService(s.id)}>
                Delete
              </button>
            </div>
            <div className="muted small" style={{ marginBottom: 4 }}>Valid for</div>
            {typeChips("service", s.id, typesFor(serviceTypes, s.id, "service_id"))}
          </div>
        ))}
        {services.length === 0 && <p className="muted small">No services yet.</p>}
      </div>

      <div className="section-title">Amenities</div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder="New amenity (e.g. Fire pit)"
          value={amenityDraft}
          onChange={(e) => setAmenityDraft(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!amenityDraft.trim()}
          onClick={() => {
            void createAmenity({ name: amenityDraft.trim() });
            setAmenityDraft("");
          }}
        >
          Add amenity
        </button>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {amenities.map((a) => (
          <div key={a.id} className="card">
            <div className="row" style={{ alignItems: "center", marginBottom: 8 }}>
              <DraftInput className="input" style={{ maxWidth: 240 }} value={a.name} onCommit={(name) => void saveAmenity(a.id, { name })} />
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => window.confirm(`Delete ${a.name}?`) && void deleteAmenity(a.id)}>
                Delete
              </button>
            </div>
            <div className="muted small" style={{ marginBottom: 4 }}>Valid for</div>
            {typeChips("amenity", a.id, typesFor(amenityTypes, a.id, "amenity_id"))}
          </div>
        ))}
        {amenities.length === 0 && <p className="muted small">No amenities yet.</p>}
      </div>
    </div>
  );
}
