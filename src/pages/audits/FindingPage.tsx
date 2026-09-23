import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { gpsPrompt, mergeSearchMatch, unexpectedOccupancy } from "../../lib/audits";
import {
  saveFinding,
  setAnswerTicket,
  useAudit,
  useAuditTarget,
  useFinding,
  useFindingAmenities,
  useFindingAnswers,
  useFindingBoats,
  useFindingServices,
  useFindingVehicles,
  useProposalsForFinding,
  useTargetQuestions,
  parseProposalPayload,
  type AuditCategoryFlags,
  type AuditQuestionRow,
  type ProposalKind,
} from "../../data/audits";
import {
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
  recordMeterReading,
} from "../../data/services";
import { useLocationStatuses, useTicketStatuses } from "../../data/lookups";
import { useLocationTypes, useLocations } from "../../data/locations";
import { createBoat, createVehicle, saveBoat, useBoats, useVehicles, type BoatRow } from "../../data/boats";
import { createContact, useContacts } from "../../data/contacts";
import { useLeasesForLocation } from "../../data/leases";
import { useReservationsForTarget } from "../../data/reservations";
import { useMarinaSettings } from "../../data/settings";
import { createTicket } from "../../data/tickets";
import type { AttachmentTarget } from "../../data/attachments";
import { LocationPicker } from "../shared/LocationPicker";
import { NoteDialog } from "../shared/NoteDialog";
import { PlacementCheck, type ProposedPlacement } from "./PlacementCheck";

// The Finding form (docs/audits.md § Field work). One screen for one target:
// the built-in questions of the audit's kind, the target's own questions,
// the GPS prompt when the pin is missing or far, and the actions that hang
// off a location. What applies at once and what becomes a Proposal is
// decided in saveFinding(), not here. The same screen, with no target,
// proposes a new location.

type YesNo = boolean | null;

interface Answer {
  value: unknown;
}

export function FindingPage() {
  const { id: auditId, targetId } = useParams();
  const proposing = !targetId;
  const { audit } = useAudit(auditId);
  const { target } = useAuditTarget(targetId);
  if (!audit || (!proposing && !target)) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }
  return (
    <FindingForm
      auditId={audit.id}
      auditName={audit.name}
      kind={audit.kind}
      status={audit.status}
      target={proposing ? null : target}
      categories={audit}
    />
  );
}

function FindingForm({
  auditId,
  auditName,
  kind,
  status,
  target,
  categories,
}: {
  auditId: string;
  auditName: string;
  kind: "occupancy" | "status";
  status: string;
  target: ReturnType<typeof useAuditTarget>["target"] | null;
  /** Which built-in Status-kind sections this audit asks about. */
  categories: AuditCategoryFlags;
}) {
  const current = useCurrent();
  const navigate = useNavigate();
  const settings = useMarinaSettings();
  const locationId = target?.location_id ?? null;
  const readOnly = status !== "open";

  // Existing finding and its parts, when re-opening one.
  const { finding } = useFinding(target?.finding_id ?? undefined);
  const isAuthor = !finding || finding.recorded_by_id === current.user?.id;
  const editable = !readOnly && isAuthor;
  const { data: fBoats } = useFindingBoats(finding?.id);
  const { data: fVehicles } = useFindingVehicles(finding?.id);
  const { data: fServices } = useFindingServices(finding?.id);
  const { data: fAmenities } = useFindingAmenities(finding?.id);
  const { data: fAnswers } = useFindingAnswers(finding?.id);
  const { data: fProposals } = useProposalsForFinding(finding?.id);

  const { data: questions } = useTargetQuestions(target?.id);
  const { statuses } = useLocationStatuses();
  const { statuses: ticketStatuses } = useTicketStatuses();
  const { data: types } = useLocationTypes();
  const { data: locations } = useLocations();
  const { data: services } = useServices();
  const { data: amenities } = useAmenities();
  const { data: attributes } = useAttributes();
  const { data: serviceValidity } = useServiceValidity();
  const { data: amenityValidity } = useAmenityValidity();
  const { data: attributeValidity } = useAttributeValidity();
  const { data: currentServices } = useLocationServices(locationId ?? undefined);
  const { data: currentAmenities } = useLocationAmenities(locationId ?? undefined);
  const { data: currentAttributes } = useLocationAttributes(locationId ?? undefined);
  const { data: leases } = useLeasesForLocation(locationId ?? undefined);
  const { data: reservations } = useReservationsForTarget("location", locationId ?? undefined);

  // ── form state ──
  const [name, setName] = useState("");
  const [typeId, setTypeId] = useState(target?.location_type_id ?? "");
  const [parentId, setParentId] = useState(target?.parent_id ?? "");
  const [statusId, setStatusId] = useState(target?.status_id ?? "");
  const [occupied, setOccupied] = useState<YesNo>(null);
  const [boatIds, setBoatIds] = useState<string[]>([]);
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [contactId, setContactId] = useState<string | null>(null);
  const [clearlyMarked, setClearlyMarked] = useState<YesNo>(null);
  const [mappedCorrectly, setMappedCorrectly] = useState<YesNo>(null);
  const [svc, setSvc] = useState<Record<string, { present: boolean; working: boolean; note: string }>>({});
  const [amen, setAmen] = useState<Record<string, { present: boolean; note: string }>>({});
  const [attr, setAttr] = useState<Record<string, { present: boolean; value: string; note: string }>>({});
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [gpsCapture, setGpsCapture] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [placement, setPlacement] = useState<ProposedPlacement | null>(null);
  const [retire, setRetire] = useState(false);
  const [rename, setRename] = useState("");
  const [showChanges, setShowChanges] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState(false);

  const typeIdOfTarget = target?.location_type_id ?? typeId;
  const validServices = useMemo(
    () => services.filter((s) => serviceValidity.some((v) => v.service_id === s.id && v.location_type_id === typeIdOfTarget)),
    [services, serviceValidity, typeIdOfTarget],
  );
  const validAmenities = useMemo(
    () => amenities.filter((a) => amenityValidity.some((v) => v.amenity_id === a.id && v.location_type_id === typeIdOfTarget)),
    [amenities, amenityValidity, typeIdOfTarget],
  );
  const validAttributes = useMemo(
    () => attributes.filter((a) => attributeValidity.some((v) => v.attribute_id === a.id && v.location_type_id === typeIdOfTarget)),
    [attributes, attributeValidity, typeIdOfTarget],
  );

  // Seed from the location's current state, or the existing finding, once.
  useEffect(() => {
    if (seeded) return;
    if (target && target.finding_id && !finding) return; // wait for it
    const s: typeof svc = {};
    for (const v of validServices) {
      const cur = currentServices.find((c) => c.service_id === v.id);
      const f = fServices.find((c) => c.service_id === v.id);
      s[v.id] = f
        ? { present: f.present === 1, working: f.working === 1, note: f.note ?? "" }
        : { present: !!cur, working: cur ? cur.working === 1 : true, note: cur?.note ?? "" };
    }
    const a: typeof amen = {};
    for (const v of validAmenities) {
      const cur = currentAmenities.find((c) => c.amenity_id === v.id);
      const f = fAmenities.find((c) => c.amenity_id === v.id);
      a[v.id] = f ? { present: f.present === 1, note: f.note ?? "" } : { present: !!cur, note: cur?.note ?? "" };
    }
    // Attributes have no finding-parts table of their own — every change is
    // a Proposal, so an already-recorded observation lives in that
    // Proposal's payload, the same way GPS and rename do.
    const at: typeof attr = {};
    for (const v of validAttributes) {
      const cur = currentAttributes.find((c) => c.attribute_id === v.id);
      const prop = fProposals.find((p) => p.kind === "set_attribute" && String(parseProposalPayload(p).attribute_id) === v.id);
      if (prop) {
        const pl = parseProposalPayload(prop);
        at[v.id] = {
          present: Boolean(pl.present),
          value: pl.value != null ? String(pl.value) : "",
          note: pl.note != null ? String(pl.note) : "",
        };
      } else {
        at[v.id] = { present: !!cur, value: cur ? String(cur.value) : "", note: cur?.note ?? "" };
      }
    }
    if (
      validServices.length === 0 &&
      validAmenities.length === 0 &&
      validAttributes.length === 0 &&
      !finding &&
      services.length + amenities.length + attributes.length > 0 &&
      serviceValidity.length + amenityValidity.length + attributeValidity.length === 0
    ) {
      // Catalogue exists but validity not synced yet; keep waiting.
      return;
    }
    setSvc(s);
    setAmen(a);
    setAttr(at);
    if (finding) {
      setOccupied(finding.occupied === null ? null : finding.occupied === 1);
      setContactId(finding.contact_id);
      setClearlyMarked(finding.clearly_marked === null ? null : finding.clearly_marked === 1);
      setMappedCorrectly(finding.mapped_correctly === null ? null : finding.mapped_correctly === 1);
      setBoatIds(fBoats.map((b) => b.boat_id));
      setVehicleIds(fVehicles.map((v) => v.vehicle_id));
      const ans: Record<string, Answer> = {};
      for (const r of fAnswers) {
        try {
          ans[r.question_id] = { value: JSON.parse(r.value) };
        } catch {
          /* ignore */
        }
      }
      setAnswers(ans);
      for (const p of fProposals) {
        const pl = parseProposalPayload(p);
        if (p.kind === "retire_location") setRetire(true);
        if (p.kind === "rename") setRename(String(pl.name ?? ""));
        if (p.kind === "set_gps") setGpsCapture({ lat: Number(pl.lat), lng: Number(pl.lng), accuracy: Number(pl.accuracy) });
        if (p.kind === "move_placement") setPlacement({ map_id: String(pl.map_id), placement: pl.placement as ProposedPlacement["placement"] });
        if (p.kind === "create_location") {
          setName(String(pl.name ?? ""));
          setTypeId(String(pl.location_type_id ?? ""));
          setParentId(String(pl.parent_id ?? ""));
        }
      }
    }
    setSeeded(true);
  }, [seeded, target, finding, validServices, validAmenities, validAttributes, currentServices, currentAmenities, currentAttributes, fServices, fAmenities, fBoats, fVehicles, fAnswers, fProposals, services.length, amenities.length, attributes.length, serviceValidity.length, amenityValidity.length, attributeValidity.length, locations.length]);

  // Expected occupancy from what is on file.
  const now = Date.now();
  const hasCurrentLease = leases.some(
    (l) => (!l.start_date || new Date(l.start_date).getTime() <= now) && (!l.end_date || new Date(l.end_date).getTime() >= now),
  );
  const hasActiveReservation = reservations.some((r) => r.status === "checked_in");
  const unexpected = kind === "occupancy" && occupied !== null && unexpectedOccupancy({ occupied, hasCurrentLease, hasActiveReservation });

  const locationTarget: AttachmentTarget | null = target?.location_id
    ? { type: "location", id: target.location_id, label: target.location_name }
    : parentId
      ? { type: "location", id: parentId, label: locations.find((l) => l.id === parentId)?.name ?? "parent" }
      : null;

  const typeRow = types.find((t) => t.id === typeIdOfTarget);
  const holdsBoat = !!typeRow && typeRow.has_boat === 1;
  const holdsVehicle = !!typeRow && typeRow.has_vehicle === 1;

  // A proposed new location isn't governed by any audit's category toggles
  // — it's initial data entry, not a question being asked about an
  // existing one. For an existing target, a Status audit that turned a
  // category off simply never renders that section.
  const asksStatusQuestions = kind === "status" || !target;
  const showServices = asksStatusQuestions && (!target || categories.include_services === 1) && validServices.length > 0;
  const showAmenities = asksStatusQuestions && (!target || categories.include_amenities === 1) && validAmenities.length > 0;
  const showAttributes = asksStatusQuestions && (!target || categories.include_attributes === 1) && validAttributes.length > 0;
  const showMarked = kind === "status" && !!target && categories.include_marked === 1;
  const showMap = kind === "status" && !!target && categories.include_map === 1;

  const canSave =
    editable &&
    !saving &&
    (target ? true : name.trim() !== "" && typeId !== "") &&
    (kind !== "occupancy" || occupied !== null || !target);

  const save = async () => {
    if (!current.user) return;
    setSaving(true);
    setError(null);
    try {
      const proposals: { kind: ProposalKind; payload: Record<string, unknown> }[] = [];
      if (!target) {
        proposals.push({
          kind: "create_location",
          payload: {
            name: name.trim(),
            location_type_id: typeId,
            parent_id: parentId || null,
            gps_lat: gpsCapture?.lat ?? null,
            gps_lng: gpsCapture?.lng ?? null,
            status_id: statusId || null,
            services: Object.entries(svc).filter(([, v]) => v.present).map(([id]) => id),
            amenities: Object.entries(amen).filter(([, v]) => v.present).map(([id]) => id),
          },
        });
      } else {
        if (gpsCapture) proposals.push({ kind: "set_gps", payload: gpsCapture });
        if (placement) proposals.push({ kind: "move_placement", payload: { map_id: placement.map_id, placement: placement.placement } });
        if (retire) proposals.push({ kind: "retire_location", payload: {} });
        if (rename.trim() && rename.trim() !== target.location_name) proposals.push({ kind: "rename", payload: { name: rename.trim() } });
        if (typeId && typeId !== target.location_type_id) proposals.push({ kind: "retype", payload: { location_type_id: typeId } });
        if (parentId !== (target.parent_id ?? "")) proposals.push({ kind: "reparent", payload: { parent_id: parentId || null } });
      }
      const findingId = await saveFinding(
        {
          auditId,
          kind,
          targetId: target?.id ?? null,
          locationId,
          existingFindingId: finding?.id ?? null,
          occupied: kind === "occupancy" ? occupied : null,
          contactId,
          boatIds,
          vehicleIds,
          statusId: target && statusId && statusId !== target.status_id ? statusId : null,
          clearlyMarked: kind === "status" ? clearlyMarked : null,
          mappedCorrectly: kind === "status" ? mappedCorrectly : null,
          services: target
            ? Object.entries(svc).map(([serviceId, v]) => ({ serviceId, present: v.present, working: v.working, note: v.note || null }))
            : [],
          amenities: target ? Object.entries(amen).map(([amenityId, v]) => ({ amenityId, present: v.present, note: v.note || null })) : [],
          // Skip "present, no value typed yet" — a half-entered attribute
          // is not an observation, and location_attributes.value is not null.
          attributes: target
            ? Object.entries(attr)
                .filter(([, v]) => !(v.present && v.value.trim() === ""))
                .map(([attributeId, v]) => ({
                  attributeId,
                  present: v.present,
                  value: v.value.trim() === "" ? null : Number(v.value),
                  note: v.note || null,
                }))
            : [],
          answers: Object.entries(answers).map(([questionId, a]) => ({ questionId, value: a.value })),
          proposals,
          expected: { hasCurrentLease, hasActiveReservation },
        },
        current.user.id,
      );
      // Ticket-on-No questions and meter readings, after the finding exists.
      const openStatus = ticketStatuses.find((s) => s.is_terminal === 0) ?? ticketStatuses[0];
      for (const q of questions) {
        const a = answers[q.id];
        if (!a) continue;
        if (q.kind === "yes_no" && q.ticket_on_no === 1 && a.value === false && openStatus && locationTarget) {
          const already = fAnswers.find((r) => r.question_id === q.id)?.ticket_id;
          if (already) continue;
          const ticketId = await createTicket(
            { title: q.prompt, priority: "medium", target: locationTarget, statusId: openStatus.id, sourceFindingId: findingId },
            current.user.id,
          );
          await setAnswerTicket(findingId, q.id, ticketId);
        }
        if (q.kind === "meter_reading" && typeof a.value === "number" && q.service_id) {
          const row = currentServices.find((c) => c.service_id === q.service_id && c.metered === 1);
          if (row) await recordMeterReading({ locationServiceId: row.id, value: a.value, readById: current.user.id, sourceFindingId: findingId });
        }
      }
      navigate(`/audits/${auditId}`, { replace: true });
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e));
      setSaving(false);
    }
  };

  const yesNo = (value: YesNo, set: (v: YesNo) => void, labels: [string, string] = ["Yes", "No"]) => (
    <div className="chip-row" style={{ marginBottom: 0 }}>
      <button type="button" className={`chip ${value === true ? "tree-match" : ""}`} disabled={!editable} onClick={() => set(true)}>
        {labels[0]}
      </button>
      <button type="button" className={`chip ${value === false ? "tree-match" : ""}`} disabled={!editable} onClick={() => set(false)}>
        {labels[1]}
      </button>
    </div>
  );

  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title">{target ? target.location_name : "Propose a new location"}</h1>
          <div className="page-sub">
            <Link to={`/audits/${auditId}`}>← {auditName}</Link>
            {target && ` · ${target.type_name ?? ""}${target.status_name ? ` · ${target.status_name}` : ""}`}
            {finding && !isAuthor && " · recorded by someone else - read only"}
            {readOnly && " · audit closed"}
          </div>
        </div>
        {unexpected && <span className="badge badge-warn">Unexpected occupancy</span>}
      </div>
      {target?.displaced_note && (
        <div className="badge badge-warn" style={{ marginBottom: 10, display: "inline-block" }}>
          {target.displaced_note}
        </div>
      )}

      {!target && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="field">
            <span className="field-label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. BH14-27L" />
          </div>
          <div className="field">
            <span className="field-label">Type</span>
            <select className="select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              <option value="">Choose…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Under</span>
            <LocationPicker locations={locations.map((l) => ({ id: l.id, name: l.name, parent_id: l.parent_id }))} value={parentId} onChange={setParentId} placeholder="Search the parent…" />
          </div>
        </div>
      )}

      {/* Status: applies at once. */}
      {(target ? target.type_name !== null : typeId !== "") && statuses.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="field">
            <span className="field-label">Status</span>
            <select className="select select-inline" value={statusId} disabled={!editable} onChange={(e) => setStatusId(e.target.value)}>
              <option value="">{target ? "Leave as is" : "None"}</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {kind === "occupancy" && target && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="field">
            <span className="field-label">Occupied?</span>
            {yesNo(occupied, setOccupied)}
            <span className="muted small">
              {hasCurrentLease ? "Lease on file. " : hasActiveReservation ? "Checked-in reservation on file. " : "Nothing on file. "}
              {occupied !== null && (unexpected ? "That does not match." : "That matches.")}
            </span>
          </div>
          {occupied && (
            <>
              {holdsBoat && <OccupantPicker kind="boat" ids={boatIds} setIds={setBoatIds} editable={editable} actorId={current.user?.id ?? null} />}
              {holdsVehicle && <OccupantPicker kind="vehicle" ids={vehicleIds} setIds={setVehicleIds} editable={editable} actorId={current.user?.id ?? null} />}
              <ContactPicker contactId={contactId} setContactId={setContactId} editable={editable} actorId={current.user?.id ?? null} />
            </>
          )}
        </div>
      )}

      {(showServices || showAmenities || showAttributes) && (
        <div className="card" style={{ marginBottom: 12 }}>
          {showServices && <div className="section-title">Services</div>}
          {showServices && validServices.map((s) => {
            const v = svc[s.id] ?? { present: false, working: true, note: "" };
            return (
              <div key={s.id} className="field">
                <span className="field-label">{s.name}</span>
                <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {yesNo(v.present, (p) => setSvc({ ...svc, [s.id]: { ...v, present: !!p } }), ["Present", "Absent"])}
                  {v.present && target && (
                    <>
                      <label className="muted small">
                        <input type="checkbox" checked={v.working} disabled={!editable} onChange={(e) => setSvc({ ...svc, [s.id]: { ...v, working: e.target.checked } })} /> working
                      </label>
                      <NoteInput kind="service" entryId={s.id} value={v.note} editable={editable} onChange={(note) => setSvc({ ...svc, [s.id]: { ...v, note } })} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {showAmenities && <div className="section-title">Amenities</div>}
          {showAmenities && validAmenities.map((a) => {
            const v = amen[a.id] ?? { present: false, note: "" };
            return (
              <div key={a.id} className="field">
                <span className="field-label">{a.name}</span>
                <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {yesNo(v.present, (p) => setAmen({ ...amen, [a.id]: { ...v, present: !!p } }), ["Present", "Absent"])}
                  {v.present && target && <NoteInput kind="amenity" entryId={a.id} value={v.note} editable={editable} onChange={(note) => setAmen({ ...amen, [a.id]: { ...v, note } })} />}
                </div>
              </div>
            );
          })}
          {showAttributes && <div className="section-title">Attributes</div>}
          {showAttributes && validAttributes.map((a) => {
            const v = attr[a.id] ?? { present: false, value: "", note: "" };
            return (
              <div key={a.id} className="field">
                <span className="field-label">{a.name}</span>
                <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {yesNo(v.present, (p) => setAttr({ ...attr, [a.id]: { ...v, present: !!p } }), ["Present", "Absent"])}
                  {v.present && target && (
                    <>
                      <input
                        className="input select-inline"
                        type="number"
                        step="any"
                        style={{ width: 90 }}
                        placeholder="value"
                        disabled={!editable}
                        value={v.value}
                        onChange={(e) => setAttr({ ...attr, [a.id]: { ...v, value: e.target.value } })}
                      />
                      {a.unit && <span className="muted small">{a.unit}</span>}
                      <NoteInput kind="attribute" entryId={a.id} value={v.note} editable={editable} onChange={(note) => setAttr({ ...attr, [a.id]: { ...v, note } })} />
                    </>
                  )}
                </div>
              </div>
            );
          })}
          {target && (showServices || showAttributes) && (
            <p className="muted small">
              {showServices && showAttributes
                ? "Presence and attribute values wait for approval; working and service notes apply now."
                : showAttributes
                  ? "Presence and values wait for approval."
                  : "Presence changes wait for approval; working and notes apply now."}
            </p>
          )}
        </div>
      )}

      {(showMarked || showMap) && (
        <div className="card" style={{ marginBottom: 12 }}>
          {showMarked && (
            <div className="field">
              <span className="field-label">Is this location clearly marked?</span>
              {yesNo(clearlyMarked, setClearlyMarked)}
            </div>
          )}
          {showMap && (
            <div className="field">
              <span className="field-label">Is it placed correctly on the map?</span>
              {target?.location_id && (
                <div style={{ marginBottom: 8 }}>
                  <PlacementCheck
                    locationId={target.location_id}
                    locationName={target.location_name}
                    editable={editable}
                    proposed={placement}
                    onPropose={(p) => {
                      setPlacement(p);
                      if (p) setMappedCorrectly(false);
                    }}
                  />
                </div>
              )}
              {yesNo(mappedCorrectly, setMappedCorrectly)}
            </div>
          )}
        </div>
      )}

      {questions.length > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div className="section-title">Questions</div>
          {questions.map((q) => (
            <QuestionField key={q.id} q={q} answer={answers[q.id]} editable={editable} onChange={(value) => setAnswers({ ...answers, [q.id]: { value } })} />
          ))}
        </div>
      )}

      <GpsBlock
        locationName={target?.location_name ?? (name || "this location")}
        pin={target && target.gps_lat !== null && target.gps_lng !== null ? { lat: target.gps_lat, lng: target.gps_lng } : null}
        radius={settings.auditGpsRadius}
        accuracyLimit={settings.auditGpsAccuracy}
        captured={gpsCapture}
        editable={editable}
        onCapture={setGpsCapture}
      />

      {target && (
        <div className="card" style={{ marginBottom: 12 }}>
          <button type="button" className="tree-head" onClick={() => setShowChanges(!showChanges)}>
            <span className="card-title">Propose a change {showChanges ? "▾" : "▸"}</span>
            <span className="muted small"> - name, type, parent, or retire. Waits for approval.</span>
          </button>
          {showChanges && (
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              <div className="field">
                <span className="field-label">Rename to</span>
                <input className="input" value={rename} disabled={!editable} placeholder={target.location_name} onChange={(e) => setRename(e.target.value)} />
              </div>
              <div className="field">
                <span className="field-label">Type</span>
                <select className="select select-inline" value={typeId} disabled={!editable} onChange={(e) => setTypeId(e.target.value)}>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <span className="field-label">Under</span>
                <LocationPicker locations={locations.map((l) => ({ id: l.id, name: l.name, parent_id: l.parent_id }))} value={parentId} onChange={setParentId} excludeId={target.location_id ?? undefined} />
              </div>
              <label>
                <input type="checkbox" checked={retire} disabled={!editable} onChange={(e) => setRetire(e.target.checked)} /> This location is not here - propose retiring it
              </label>
            </div>
          )}
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {locationTarget && (
          <>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => navigate("/tickets/new", { state: { target: locationTarget, sourceFindingId: finding?.id ?? null } })}
            >
              + Ticket
            </button>
            {current.can("create_incidents") && (
              <button type="button" className="btn btn-sm" onClick={() => navigate("/incidents/new", { state: { target: locationTarget } })}>
                + Incident
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => setNoteOpen(true)}>
              + Note
            </button>
          </>
        )}
      </div>
      {noteOpen && locationTarget && <NoteDialog target={locationTarget} onClose={() => setNoteOpen(false)} />}

      {error && <div className="badge badge-bad" style={{ marginBottom: 8 }}>{error}</div>}
      {editable && (
        <button type="button" className="btn btn-primary btn-block" disabled={!canSave} onClick={() => void save()}>
          {saving ? "Saving…" : finding ? "Update finding" : target ? "Save finding" : "Propose location"}
        </button>
      )}
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────

function NoteInput({
  kind,
  entryId,
  value,
  editable,
  onChange,
}: {
  kind: "service" | "amenity" | "attribute";
  entryId: string;
  value: string;
  editable: boolean;
  onChange: (v: string) => void;
}) {
  const suggestions = useNoteSuggestions(kind, entryId);
  const listId = `notes-${kind}-${entryId}`;
  return (
    <>
      <input className="input select-inline" list={listId} placeholder="note" value={value} disabled={!editable} onChange={(e) => onChange(e.target.value)} style={{ width: 160 }} />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

function QuestionField({
  q,
  answer,
  editable,
  onChange,
}: {
  q: AuditQuestionRow;
  answer: Answer | undefined;
  editable: boolean;
  onChange: (value: unknown) => void;
}) {
  const v = answer?.value;
  let choices: string[] = [];
  try {
    choices = q.choices ? (JSON.parse(q.choices) as string[]) : [];
  } catch {
    choices = [];
  }
  return (
    <div className="field">
      <span className="field-label">{q.prompt}</span>
      {q.kind === "yes_no" && (
        <div className="chip-row" style={{ marginBottom: 0 }}>
          <button type="button" className={`chip ${v === true ? "tree-match" : ""}`} disabled={!editable} onClick={() => onChange(true)}>
            Yes
          </button>
          <button type="button" className={`chip ${v === false ? "tree-match" : ""}`} disabled={!editable} onClick={() => onChange(false)}>
            No{q.ticket_on_no === 1 ? " (raises a ticket)" : ""}
          </button>
        </div>
      )}
      {q.kind === "choice" && (
        <select className="select select-inline" value={typeof v === "string" ? v : ""} disabled={!editable} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}
      {q.kind === "text" && <input className="input" value={typeof v === "string" ? v : ""} disabled={!editable} onChange={(e) => onChange(e.target.value)} />}
      {q.kind === "meter_reading" && (
        <input className="input select-inline" type="number" step="any" value={typeof v === "number" ? v : ""} disabled={!editable} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />
      )}
    </div>
  );
}

function GpsBlock({
  locationName,
  pin,
  radius,
  accuracyLimit,
  captured,
  editable,
  onCapture,
}: {
  locationName: string;
  pin: { lat: number; lng: number } | null;
  radius: number;
  accuracyLimit: number;
  captured: { lat: number; lng: number; accuracy: number } | null;
  editable: boolean;
  onCapture: (fix: { lat: number; lng: number; accuracy: number } | null) => void;
}) {
  const [device, setDevice] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [standing, setStanding] = useState(false);
  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setDevice({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => setDevice(null),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  const decision = gpsPrompt({ location: pin, device, radius, accuracyLimit });
  if (!decision.prompt && !captured) return null;
  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: "4px solid var(--accent)" }}>
      <div className="card-kicker">
        <span>GPS</span>
        <span>
          {decision.accuracyMeters !== null ? `accuracy ${Math.round(decision.accuracyMeters)} m` : "no fix yet"}
        </span>
      </div>
      {captured ? (
        <div className="row" style={{ alignItems: "center", gap: 8 }}>
          <span className="badge badge-good">Coordinates captured (±{Math.round(captured.accuracy)} m) - waits for approval</span>
          {editable && (
            <button type="button" className="btn btn-sm btn-bare" onClick={() => onCapture(null)}>
              discard
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="muted small" style={{ marginBottom: 6 }}>
            {decision.reason === "missing"
              ? `${locationName} has no coordinates yet.`
              : `You are ${Math.round(decision.distanceMeters ?? 0)} m from where ${locationName} is pinned.`}
            {!decision.captureEnabled && decision.accuracyMeters !== null && ` GPS accuracy ${Math.round(decision.accuracyMeters)} m - move into the open and try again.`}
          </div>
          <label style={{ display: "block", marginBottom: 6 }}>
            <input type="checkbox" checked={standing} disabled={!editable} onChange={(e) => setStanding(e.target.checked)} /> I am standing directly at {locationName}
          </label>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!editable || !standing || !decision.captureEnabled || !device}
            onClick={() => device && onCapture(device)}
          >
            Use my position
          </button>
        </>
      )}
    </div>
  );
}

/** Search boats or vehicles by name/registration; create when nothing matches. */
function OccupantPicker({
  kind,
  ids,
  setIds,
  editable,
  actorId,
}: {
  kind: "boat" | "vehicle";
  ids: string[];
  setIds: (ids: string[]) => void;
  editable: boolean;
  actorId: string | null;
}) {
  const { data: boats } = useBoats();
  const { data: vehicles } = useVehicles();
  const [name, setName] = useState("");
  const [reg, setReg] = useState("");
  const [offer, setOffer] = useState<{ record: BoatRow; updates: { field: string; from: string | null; to: string }[] } | null>(null);
  void actorId;
  const options = kind === "boat" ? boats.map((b) => ({ id: b.id, label: b.name, hint: b.registration_number ?? "", row: b })) : vehicles.map((v) => ({ id: v.id, label: v.description, hint: v.plate_number ?? "", row: null }));
  // Match on whichever fields were typed; an empty field matches nothing,
  // or every boat would be a match for a registration alone.
  const n = name.trim().toLowerCase();
  const r = reg.trim().toLowerCase();
  const q = n || r;
  const matches = q
    ? options
        .filter((o) => !ids.includes(o.id) && ((n !== "" && o.label.toLowerCase().includes(n)) || (r !== "" && o.hint.toLowerCase().includes(r))))
        .slice(0, 8)
    : [];
  const chosen = options.filter((o) => ids.includes(o.id));
  const pick = (o: (typeof options)[number]) => {
    // Never erase what was typed: the record's values win in the form, and a
    // typed value the record lacks or contradicts is offered as an update.
    if (kind === "boat" && o.row) {
      const m = mergeSearchMatch({ name: name, registration: reg }, { id: o.row.id, name: o.row.name, registration: o.row.registration_number });
      if (m.updates.length) setOffer({ record: o.row, updates: m.updates });
    }
    setIds([...ids, o.id]);
    setName("");
    setReg("");
  };
  const create = async () => {
    const id =
      kind === "boat"
        ? await createBoat({ name: name.trim() || reg.trim(), registrationNumber: reg.trim() || null })
        : await createVehicle({ description: name.trim() || reg.trim(), plateNumber: reg.trim() || null });
    setIds([...ids, id]);
    setName("");
    setReg("");
  };
  return (
    <div className="field">
      <span className="field-label">{kind === "boat" ? "Boats here" : "Vehicles here"}</span>
      <div className="chip-row" style={{ marginBottom: 6 }}>
        {chosen.map((o) => (
          <span key={o.id} className="chip tree-match">
            {o.label}
            {editable && (
              <button type="button" className="btn btn-bare btn-sm" aria-label="remove" onClick={() => setIds(ids.filter((x) => x !== o.id))}>
                ✕
              </button>
            )}
          </span>
        ))}
        {chosen.length === 0 && <span className="muted small">none recorded</span>}
      </div>
      {editable && (
        <>
          <div className="row" style={{ gap: 6 }}>
            <input className="input" placeholder={kind === "boat" ? "Boat name" : "Vehicle"} value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder={kind === "boat" ? "Registration" : "Plate"} value={reg} onChange={(e) => setReg(e.target.value)} style={{ maxWidth: 160 }} />
          </div>
          {q && (
            <div className="stack" style={{ gap: 4, marginTop: 4 }}>
              {matches.map((o) => (
                <button key={o.id} type="button" className="picker-option" style={{ textAlign: "left" }} onClick={() => pick(o)}>
                  {o.label} <span className="muted small">{o.hint}</span>
                </button>
              ))}
              {matches.length === 0 && (
                <button type="button" className="btn btn-sm" onClick={() => void create()}>
                  + Create “{name.trim() || reg.trim()}”
                </button>
              )}
            </div>
          )}
          {offer && (
            <div className="card" style={{ marginTop: 6, padding: 8 }}>
              <div className="muted small">You typed something the record doesn't have:</div>
              {offer.updates.map((u) => (
                <div key={u.field} className="row" style={{ gap: 6, alignItems: "center" }}>
                  <span>
                    {u.field}: <s>{u.from ?? "(empty)"}</s> → <b>{u.to}</b>
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      void saveBoat(offer.record.id, u.field === "name" ? { name: u.to } : { registrationNumber: u.to });
                      setOffer({ ...offer, updates: offer.updates.filter((x) => x !== u) });
                    }}
                  >
                    Update record
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-sm btn-bare" onClick={() => setOffer(null)}>
                dismiss
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ContactPicker({
  contactId,
  setContactId,
  editable,
  actorId,
}: {
  contactId: string | null;
  setContactId: (id: string | null) => void;
  editable: boolean;
  actorId: string | null;
}) {
  const { data: contacts } = useContacts();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const chosen = contacts.find((c) => c.id === contactId);
  const q = (name + phone).trim().toLowerCase();
  const matches = q
    ? contacts.filter((c) => (name.trim() && (c.name ?? "").toLowerCase().includes(name.trim().toLowerCase())) || (phone.trim() && (c.phone ?? "").includes(phone.trim()))).slice(0, 8)
    : [];
  return (
    <div className="field">
      <span className="field-label">Occupant (optional)</span>
      {chosen ? (
        <div className="row" style={{ alignItems: "center", gap: 6 }}>
          <span className="chip tree-match">{chosen.name ?? "Unnamed"}</span>
          {editable && (
            <button type="button" className="btn btn-sm btn-bare" onClick={() => setContactId(null)}>
              ✕
            </button>
          )}
        </div>
      ) : editable ? (
        <>
          <div className="row" style={{ gap: 6 }}>
            <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ maxWidth: 160 }} />
          </div>
          {q && (
            <div className="stack" style={{ gap: 4, marginTop: 4 }}>
              {matches.map((c) => (
                <button key={c.id} type="button" className="picker-option" style={{ textAlign: "left" }} onClick={() => setContactId(c.id)}>
                  {c.name ?? "Unnamed"} <span className="muted small">{c.phone ?? ""}</span>
                </button>
              ))}
              {matches.length === 0 && name.trim() && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={async () => setContactId(await createContact({ name: name.trim(), phone: phone.trim() || null }, actorId))}
                >
                  + Create contact “{name.trim()}”
                </button>
              )}
            </div>
          )}
          <span className="muted small">Occupied by someone who refused ID? Leave this empty.</span>
        </>
      ) : (
        <span className="muted small">none</span>
      )}
    </div>
  );
}
