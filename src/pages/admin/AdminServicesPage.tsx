import { useState } from "react";
import {
  attributeChoices,
  createAmenity,
  createAttribute,
  createService,
  deleteAmenity,
  deleteAttribute,
  deleteService,
  saveAmenity,
  saveAttribute,
  saveService,
  setValidTypes,
  useAmenities,
  useAmenityValidity,
  useAttributeValidity,
  useAttributes,
  useServiceValidity,
  useServices,
  type AttributeKind,
} from "../../data/services";
import { useLocationTypes } from "../../data/locations";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";
import { DraftInput } from "../shared/DraftInput";
import { ChoiceOptionsEditor } from "../shared/ChoiceOptionsEditor";

// Admin — Attributes, Services & Amenities (docs/audits.md § Attributes,
// Amenities). Three catalogues, each entry valid for chosen Location Types.
// Services and Amenities are presence, edited on the location itself or by
// an approved audit Proposal. An Attribute is a number the location
// enforces (maximum boat length, maximum vehicle length); once an audit
// exists it can only change through a Proposal too. This screen only
// defines what can exist and where.
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
  const { data: attributes } = useAttributes();
  const { data: serviceTypes } = useServiceValidity();
  const { data: amenityTypes } = useAmenityValidity();
  const { data: attributeTypes } = useAttributeValidity();
  const { data: types } = useLocationTypes();
  const [serviceDraft, setServiceDraft] = useState({ name: "", unit: "" });
  const [amenityDraft, setAmenityDraft] = useState("");
  const [attributeDraft, setAttributeDraft] = useState<{ name: string; kind: AttributeKind; unit: string }>({ name: "", kind: "number", unit: "" });

  const typesFor = (
    rows: { location_type_id: string; service_id?: string; amenity_id?: string; attribute_id?: string }[],
    id: string,
    key: "service_id" | "amenity_id" | "attribute_id",
  ) => rows.filter((r) => r[key] === id).map((r) => r.location_type_id);

  const toggleType = (
    kind: "service" | "amenity" | "attribute",
    entryId: string,
    typeId: string,
    current: string[],
  ) =>
    void setValidTypes(
      kind,
      entryId,
      current.includes(typeId) ? current.filter((t) => t !== typeId) : [...current, typeId],
    );

  const typeChips = (kind: "service" | "amenity" | "attribute", entryId: string, current: string[]) => (
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
      <AdminHeader title="Attributes, Services, & Amenities" />
      <div className="section-title">Attributes</div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder="New attribute (e.g. Max boat length)"
          value={attributeDraft.name}
          onChange={(e) => setAttributeDraft({ ...attributeDraft, name: e.target.value })}
        />
        <select
          className="select select-inline"
          aria-label="New attribute kind"
          value={attributeDraft.kind}
          onChange={(e) => setAttributeDraft({ ...attributeDraft, kind: e.target.value as AttributeKind })}
        >
          <option value="number">Number</option>
          <option value="choice">Choice</option>
        </select>
        {attributeDraft.kind === "number" && (
          <input
            className="input"
            style={{ maxWidth: 120 }}
            placeholder="Unit (ft)"
            value={attributeDraft.unit}
            onChange={(e) => setAttributeDraft({ ...attributeDraft, unit: e.target.value })}
          />
        )}
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!attributeDraft.name.trim()}
          onClick={() => {
            void createAttribute({
              name: attributeDraft.name.trim(),
              kind: attributeDraft.kind,
              unit: attributeDraft.kind === "number" ? attributeDraft.unit.trim() || null : null,
            });
            setAttributeDraft({ name: "", kind: "number", unit: "" });
          }}
        >
          Add attribute
        </button>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {attributes.map((a) => (
          <div key={a.id} className="card">
            <div className="row" style={{ alignItems: "center", marginBottom: 8 }}>
              <DraftInput className="input" style={{ maxWidth: 240 }} value={a.name} onCommit={(name) => void saveAttribute(a.id, { name })} />
              <select
                className="select select-inline"
                aria-label={`${a.name} kind`}
                value={a.kind}
                onChange={(e) => void saveAttribute(a.id, { kind: e.target.value as AttributeKind })}
              >
                <option value="number">Number</option>
                <option value="choice">Choice</option>
              </select>
              {a.kind === "number" && (
                <DraftInput
                  className="input"
                  style={{ maxWidth: 120 }}
                  placeholder="unit"
                  value={a.unit ?? ""}
                  onCommit={(unit) => void saveAttribute(a.id, { unit: unit || null })}
                />
              )}
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => window.confirm(`Delete ${a.name}?`) && void deleteAttribute(a.id)}>
                Delete
              </button>
            </div>
            {a.kind === "choice" && (
              <div style={{ marginBottom: 8 }}>
                <div className="muted small">Options</div>
                <ChoiceOptionsEditor
                  choices={attributeChoices(a)}
                  onChange={(choices) => void saveAttribute(a.id, { choices })}
                  emptyMessage="No options yet — there is nothing to pick from at a location."
                />
              </div>
            )}
            <div className="muted small" style={{ marginBottom: 4 }}>Valid for</div>
            {typeChips("attribute", a.id, typesFor(attributeTypes, a.id, "attribute_id"))}
          </div>
        ))}
        {attributes.length === 0 && <p className="muted small">No attributes yet.</p>}
      </div>
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
