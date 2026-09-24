// PROTOTYPE — throwaway. Three variants of the audit wizard, switchable via
// ?variant= on /audits/:id/wizard-prototype. Question being answered: what
// does a step look like, and how does an auditor move between locations and
// items - a single queue (A), a location page (B), or two visible axes (C)?
//
// Decisions it is built on (owner, 2026-09-23): items are entry-level with a
// select-all checkbox per group, everything selected by default; the run is
// location-major (a sweep of one item is just a run with one item selected);
// it saves after every change; a partial run still counts as audited.
//
// Reads a real audit through the data layer and WRITES NOTHING - answers are
// held in memory and the save indicator is a stand-in. The real thing needs
// a merge-save in src/data/audits.ts, which is the point of the spec.
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useAudit, useAuditQuestions, useAuditTargets } from "../../../data/audits";
import { useLocationStatuses } from "../../../data/lookups";
import {
  attributeChoices,
  useAmenities,
  useAmenityValidity,
  useAttributeValidity,
  useAttributes,
  useLocationAmenities,
  useLocationAttributes,
  useLocationServices,
  useServiceValidity,
  useServices,
} from "../../../data/services";
import { PrototypeSwitcher } from "../../shared/PrototypeSwitcher";
import { useAuditFindingTargets, useAuditTargetQuestions } from "./wizardData";
import {
  allKeys,
  buildCatalogue,
  buildSteps,
  itemsForTarget,
  type Answers,
  type AnswerValue,
  type ItemGroup,
  type RunProps,
  type WizardItem,
  type WizardTarget,
} from "./wizardModel";
import { WizardA, name as nameA } from "./WizardA";
import { WizardB, name as nameB } from "./WizardB";
import { WizardC, name as nameC } from "./WizardC";
import "./wizard.css";

const VARIANTS = [
  { key: "A", name: nameA },
  { key: "B", name: nameB },
  { key: "C", name: nameC },
];

export function AuditWizardPrototypePage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const variant = params.get("variant") ?? "A";
  const { audit } = useAudit(id);
  const { data: targets } = useAuditTargets(id);
  const { data: questions } = useAuditQuestions(id);
  const { data: questionTargets } = useAuditTargetQuestions(id);
  const { data: findingTargets } = useAuditFindingTargets(id);
  const { data: services } = useServices();
  const { data: amenities } = useAmenities();
  const { data: attributes } = useAttributes();
  const { data: serviceValidity } = useServiceValidity();
  const { data: amenityValidity } = useAmenityValidity();
  const { data: attributeValidity } = useAttributeValidity();
  const { statuses } = useLocationStatuses();

  const [phase, setPhase] = useState<"setup" | "run">("setup");
  // What the auditor turned OFF, not what they turned on: the catalogues
  // arrive after the first render, and a selection captured then would
  // leave every late item unchecked - which is exactly what happened.
  const [off, setOff] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"pending" | "all">("pending");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});

  const groups: ItemGroup[] = useMemo(() => {
    if (!audit) return [];
    return buildCatalogue({
      audit,
      services,
      amenities,
      // The catalogue model parses choices as JSON; an Attribute's come out
      // of the data layer as an array already.
      attributes: attributes.map((a) => ({ id: a.id, name: a.name, unit: a.unit, kind: a.kind, choices: JSON.stringify(attributeChoices(a)) })),
      serviceValidity,
      amenityValidity,
      attributeValidity,
      questions,
      questionTargets,
    });
  }, [audit, services, amenities, attributes, serviceValidity, amenityValidity, attributeValidity, questions, questionTargets]);

  const selection = useMemo(() => new Set([...allKeys(groups)].filter((k) => !off.has(k))), [groups, off]);
  const setSelection = (next: Set<string>) => setOff(new Set([...allKeys(groups)].filter((k) => !next.has(k))));

  const withFinding = useMemo(() => new Set(findingTargets.map((f) => f.target_id)), [findingTargets]);
  const answeredTarget = (targetId: string) => withFinding.has(targetId) || Object.keys(answers[targetId] ?? {}).length > 0;

  const shownTargets: WizardTarget[] = useMemo(
    () =>
      targets
        .filter((t) => (scope === "all" ? true : t.state !== "audited"))
        .map((t) => ({
          id: t.id,
          location_id: t.location_id,
          location_name: t.location_name,
          type_name: t.type_name,
          location_type_id: t.location_type_id,
          state: t.state,
          gps_lat: t.gps_lat,
          gps_lng: t.gps_lng,
        })),
    [targets, scope],
  );

  const steps = useMemo(() => buildSteps(shownTargets, groups, selection), [shownTargets, groups, selection]);
  const current = steps[Math.min(index, Math.max(0, steps.length - 1))];
  const locationId = current?.target.location_id ?? undefined;

  // What the marina already knows about the location being looked at, for
  // the "On file:" hint and the seed - the same pre-fill principle the
  // Finding form follows.
  const locServices = useLocationServices(locationId);
  const locAmenities = useLocationAmenities(locationId);
  const locAttributes = useLocationAttributes(locationId);
  const settled = [locServices, locAmenities, locAttributes].every((q) => !q.isLoading && !q.isFetching);

  const onFile = (t: WizardTarget, item: WizardItem): string | null => {
    if (!t.location_id || t.location_id !== locationId || !settled) return null;
    if (item.kind === "service") {
      const row = locServices.data.find((r) => r.service_id === item.entryId);
      if (!row) return "absent";
      return `present${row.working === 1 ? ", working" : ", not working"}${row.note ? ` - ${row.note}` : ""}`;
    }
    if (item.kind === "amenity") return locAmenities.data.some((r) => r.amenity_id === item.entryId) ? "present" : "absent";
    if (item.kind === "attribute") {
      const row = locAttributes.data.find((r) => r.attribute_id === item.entryId);
      if (!row) return null;
      return row.value_text ?? (row.value != null ? `${row.value}${item.unit ? ` ${item.unit}` : ""}` : null);
    }
    return null;
  };

  // Seed this location's answers once, from what is on file.
  const [seeded, setSeeded] = useState<Set<string>>(new Set());
  const targetId = current?.target.id;
  useEffect(() => {
    if (!targetId || !current || !settled || seeded.has(targetId)) return;
    const items = itemsForTarget(groups, selection, current.target);
    const seed: Record<string, AnswerValue> = {};
    for (const item of items) {
      if (item.kind === "service") {
        const row = locServices.data.find((r) => r.service_id === item.entryId);
        seed[item.key] = { present: !!row, working: row ? row.working === 1 : true, note: row?.note ?? "" };
      } else if (item.kind === "amenity") {
        const row = locAmenities.data.find((r) => r.amenity_id === item.entryId);
        seed[item.key] = { present: !!row, note: row?.note ?? "" };
      } else if (item.kind === "attribute") {
        const row = locAttributes.data.find((r) => r.attribute_id === item.entryId);
        seed[item.key] = { value: row?.value != null ? String(row.value) : "", text: row?.value_text ?? "", note: row?.note ?? "" };
      }
    }
    setSeeded(new Set([...seeded, targetId]));
    setAnswers((prev) => ({ ...prev, [targetId]: { ...seed, ...(prev[targetId] ?? {}) } }));
  }, [targetId, current, settled, seeded, groups, selection, locServices.data, locAmenities.data, locAttributes.data]);

  if (!audit || groups.length === 0) {
    return (
      <div className="placeholder">
        <div className="big">Loading the audit…</div>
      </div>
    );
  }

  const setAnswer = (tid: string, key: string, v: AnswerValue) =>
    setAnswers((prev) => ({ ...prev, [tid]: { ...(prev[tid] ?? {}), [key]: v } }));

  if (phase === "setup") {
    return (
      <>
        <SetupScreen
          auditName={audit.name}
          groups={groups}
          selection={selection}
          setSelection={setSelection}
          scope={scope}
          setScope={setScope}
          targetCount={shownTargets.length}
          stepCount={steps.length}
          onStart={() => {
            setIndex(0);
            setPhase("run");
          }}
        />
        <PrototypeSwitcher variants={VARIANTS} />
      </>
    );
  }

  const props: RunProps = {
    auditName: audit.name,
    targets: shownTargets,
    steps,
    index: Math.min(index, Math.max(0, steps.length - 1)),
    setIndex,
    answers,
    setAnswer,
    itemsFor: (t) => itemsForTarget(groups, selection, t),
    statuses: statuses.map((s) => ({ id: s.id, name: s.name })),
    onFile,
    answeredTarget,
    savedNote: "PROTOTYPE · nothing is saved",
    onExit: () => setPhase("setup"),
  };
  return (
    <>
      {variant === "B" ? <WizardB {...props} /> : variant === "C" ? <WizardC {...props} /> : <WizardA {...props} />}
      <PrototypeSwitcher variants={VARIANTS} />
    </>
  );
}

function SetupScreen({
  auditName,
  groups,
  selection,
  setSelection,
  scope,
  setScope,
  targetCount,
  stepCount,
  onStart,
}: {
  auditName: string;
  groups: ItemGroup[];
  selection: Set<string>;
  setSelection: (s: Set<string>) => void;
  scope: "pending" | "all";
  setScope: (s: "pending" | "all") => void;
  targetCount: number;
  stepCount: number;
  onStart: () => void;
}) {
  const toggle = (key: string) => {
    const next = new Set(selection);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelection(next);
  };
  const toggleGroup = (g: ItemGroup) => {
    const next = new Set(selection);
    const all = g.items.every((i) => next.has(i.key));
    for (const i of g.items) {
      if (all) next.delete(i.key);
      else next.add(i.key);
    }
    setSelection(next);
  };
  return (
    <div className="wz-layer">
      <div className="wz-topbar">
        <b>Wizard</b>
        <span className="muted small">{auditName}</span>
        <span className="badge badge-warn">PROTOTYPE</span>
      </div>
      <div className="wz-body">
        <div className="wz-setup">
          <p className="muted">
            What are you checking on this run? Everything is on by default - turn a group off to sweep a single item across
            the property, and run the wizard again for the next one.
          </p>
          {groups.map((g) => {
            const on = g.items.filter((i) => selection.has(i.key)).length;
            return (
              <div key={g.label} className="wz-group">
                <label className="wz-group-head">
                  <input
                    type="checkbox"
                    checked={on === g.items.length}
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < g.items.length;
                    }}
                    data-testid="wz-group-check"
                    onChange={() => toggleGroup(g)}
                  />
                  {g.label}
                  <span className="muted">
                    {on} of {g.items.length}
                  </span>
                </label>
                {g.items.map((i) => (
                  <label key={i.key} className="wz-item-row">
                    <input type="checkbox" checked={selection.has(i.key)} data-testid="wz-item-check" onChange={() => toggle(i.key)} /> {i.label}
                    {i.unit && <span className="muted">{i.unit}</span>}
                  </label>
                ))}
              </div>
            );
          })}
          <div className="wz-group">
            <div className="wz-group-head">Locations</div>
            <div className="wz-item-row">
              <div className="chip-row" style={{ marginBottom: 0 }}>
                <button type="button" className={`chip ${scope === "pending" ? "tree-match" : ""}`} onClick={() => setScope("pending")}>
                  Still to do
                </button>
                <button type="button" className={`chip ${scope === "all" ? "tree-match" : ""}`} onClick={() => setScope("all")}>
                  All, including audited
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="wz-footer">
        <span className="muted small wz-grow">
          {targetCount} locations · {stepCount} steps
        </span>
        <button type="button" className="btn btn-primary" data-testid="wz-start" disabled={stepCount === 0} onClick={onStart}>
          Start
        </button>
      </div>
    </div>
  );
}
