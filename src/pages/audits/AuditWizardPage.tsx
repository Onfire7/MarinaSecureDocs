import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useAudit, useAuditQuestions, useAuditTargets } from "../../data/audits";
import {
  recordWizardItem,
  useAuditFindingTargets,
  useAuditTargetQuestions,
  useFindingAmenitiesForTarget,
  useFindingAnswersForTarget,
  useFindingForTarget,
  useFindingProposalsForTarget,
  useFindingServicesForTarget,
} from "../../data/auditWizard";
import { useLocationStatuses, useTicketStatuses } from "../../data/lookups";
import { useLeasesForLocation } from "../../data/leases";
import { useReservationsForTarget } from "../../data/reservations";
import { createTicket } from "../../data/tickets";
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
} from "../../data/services";
import {
  allKeys,
  buildCatalogue,
  CONFIRM_KEY,
  buildSteps,
  itemsForTarget,
  sameAnswer,
  type Answers,
  type AnswerValue,
  type ItemGroup,
  type WizardItem,
  type WizardTarget,
} from "../../lib/auditWizard";
import { WizardRun } from "./wizard/WizardRun";
import type { AnswerMode, RunProps } from "./wizard/runProps";
import "./wizard/wizard.css";

// The audit wizard (AuditWizardPage.spec.md; docs/audits.md § The wizard).
// Pick what this run asks about, then walk the locations answering one item
// at a time. Every answer is written the moment it is made, and only the
// items in the run are written - see src/data/auditWizard.ts for why that
// is not saveFinding().
export function AuditWizardPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const current = useCurrent();
  const { audit, isLoading } = useAudit(id);
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
  const { statuses: ticketStatuses } = useTicketStatuses();

  const [phase, setPhase] = useState<"setup" | "run">("setup");
  // What the auditor turned OFF, not what they turned on: the catalogues
  // arrive after the first render, and a selection captured then would
  // leave every late-syncing item unchecked.
  const [off, setOff] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"pending" | "all">("pending");
  const [index, setIndex] = useState(0);
  // The list a run walks is fixed when it starts. Answering anything marks
  // that location audited, and a live "still to do" list would drop the
  // location out from under the auditor standing at it.
  const [runTargets, setRunTargets] = useState<WizardTarget[] | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  /** A value being typed in, not yet written, and what the field held
   *  before the typing started. */
  const pending = useRef<{ tid: string; key: string; v: AnswerValue; from: AnswerValue | undefined } | null>(null);

  const groups: ItemGroup[] = useMemo(() => {
    if (!audit) return [];
    return buildCatalogue({
      audit,
      services,
      amenities,
      // The model parses choices as JSON; an Attribute's arrive as an array.
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

  // Confirmed, not merely written to: a location with a pass of answers
  // against it and no confirmation is still in the queue.
  const confirmedAt = useMemo(
    () => new Map(findingTargets.filter((f) => f.confirmed_at).map((f) => [f.target_id, f.confirmed_at as string])),
    [findingTargets],
  );
  const answeredTarget = (targetId: string) =>
    confirmedAt.has(targetId) || [...touched].some((t) => t.startsWith(`${targetId}|`));

  const shownTargets: WizardTarget[] = useMemo(
    () =>
      targets
        .filter((t) => (scope === "all" ? true : t.state !== "audited"))
        .map((t) => ({
          id: t.id,
          location_id: t.location_id,
          location_name: t.location_name,
          type_name: t.type_name,
          status_name: t.status_name,
          location_type_id: t.location_type_id,
          state: t.state,
          gps_lat: t.gps_lat,
          gps_lng: t.gps_lng,
        })),
    [targets, scope],
  );

  const walked = runTargets ?? shownTargets;
  const flush = () => {
    const held = pending.current;
    pending.current = null;
    if (!held || sameAnswer(held.v, held.from)) return;
    setTouched((prev) => new Set(prev).add(`${held.tid}|${held.key}`));
    write(held.tid, held.key, held.v);
  };
  const steps = useMemo(() => buildSteps(walked, groups, selection), [walked, groups, selection]);
  const current_ = steps[Math.min(index, Math.max(0, steps.length - 1))];
  const locationId = current_?.target.location_id ?? undefined;

  // What the marina already knows about the location being looked at: the
  // "On file:" line, and the seed the auditor is confirming rather than
  // entering (docs/audits.md § Field work).
  const locServices = useLocationServices(locationId);
  const locAmenities = useLocationAmenities(locationId);
  const locAttributes = useLocationAttributes(locationId);
  // What an earlier pass recorded here, so arriving at a location shows its
  // work rather than a blank page - and so the confirmation page can list
  // the whole location, not just this run's slice.
  const findingHere = useFindingForTarget(current_?.target.id);
  const answersHere = useFindingAnswersForTarget(current_?.target.id);
  const servicesHere = useFindingServicesForTarget(current_?.target.id);
  const amenitiesHere = useFindingAmenitiesForTarget(current_?.target.id);
  const proposalsHere = useFindingProposalsForTarget(current_?.target.id);
  const settled = [locServices, locAmenities, locAttributes, findingHere, answersHere, servicesHere, amenitiesHere, proposalsHere].every(
    (q) => !q.isLoading && !q.isFetching,
  );
  const { data: leases } = useLeasesForLocation(locationId);
  const { data: reservations } = useReservationsForTarget("location", locationId);

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

  // Seed this location's answers once, from what is on file and from what
  // an earlier pass already recorded. Both settle flags, because a
  // PowerSync query keeps its previous data across a parameter change with
  // isLoading still false (CLAUDE.md).
  //
  // The seed covers EVERY item the audit asks about this location, not just
  // the ones this run selected: the confirmation page lists the lot, and a
  // sweep of one service still has to show the whole location before
  // anybody signs it off.
  const [seeded, setSeeded] = useState<Set<string>>(new Set());
  const targetId = current_?.target.id;
  useEffect(() => {
    if (!targetId || !current_ || !settled || seeded.has(targetId)) return;
    const items = itemsForTarget(groups, allKeys(groups), current_.target);
    const finding = findingHere.data[0];
    // What the audit has recorded wins over what is on file: an earlier
    // pass's answer is waiting in a Proposal, and the Location will go on
    // saying otherwise until someone approves it.
    const proposed = proposalsHere.data.map((p) => ({ kind: p.kind, payload: parsePayload(p.payload) }));
    const seed: Record<string, AnswerValue> = {};
    for (const item of items) {
      if (item.kind === "service") {
        const found = servicesHere.data.find((r) => r.service_id === item.entryId);
        const row = locServices.data.find((r) => r.service_id === item.entryId);
        seed[item.key] = found
          ? { present: found.present === 1, working: found.working === 1, note: found.note ?? "" }
          : { present: !!row, working: row ? row.working === 1 : true, note: row?.note ?? "" };
      } else if (item.kind === "amenity") {
        const found = amenitiesHere.data.find((r) => r.amenity_id === item.entryId);
        const row = locAmenities.data.find((r) => r.amenity_id === item.entryId);
        seed[item.key] = found
          ? { present: found.present === 1, note: found.note ?? "" }
          : { present: !!row, note: row?.note ?? "" };
      } else if (item.kind === "attribute") {
        const prop = proposed.find((p) => p.kind === "set_attribute" && p.payload.attribute_id === item.entryId)?.payload;
        const row = locAttributes.data.find((r) => r.attribute_id === item.entryId);
        seed[item.key] = prop
          ? { value: prop.value != null ? String(prop.value) : "", text: (prop.text as string) ?? "", note: (prop.note as string) ?? "" }
          : { value: row?.value != null ? String(row.value) : "", text: row?.value_text ?? "", note: row?.note ?? "" };
      } else if (item.kind === "gps") {
        const fix = proposed.find((p) => p.kind === "set_gps")?.payload;
        if (fix) seed[item.key] = fix as unknown as AnswerValue;
      } else if (item.kind === "question") {
        const row = answersHere.data.find((r) => r.question_id === item.entryId);
        if (row) seed[item.key] = parseAnswer(row.value);
      } else if (item.kind === "marked" && finding?.clearly_marked != null) {
        seed[item.key] = finding.clearly_marked === 1;
      } else if (item.kind === "map" && finding?.mapped_correctly != null) {
        seed[item.key] = finding.mapped_correctly === 1;
      } else if (item.kind === "occupied" && finding?.occupied != null) {
        seed[item.key] = finding.occupied === 1;
      }
    }
    setSeeded(new Set([...seeded, targetId]));
    setAnswers((prev) => ({ ...prev, [targetId]: { ...seed, ...(prev[targetId] ?? {}) } }));
  }, [
    targetId,
    current_,
    settled,
    seeded,
    groups,
    locServices.data,
    locAmenities.data,
    locAttributes.data,
    findingHere.data,
    answersHere.data,
    servicesHere.data,
    amenitiesHere.data,
    proposalsHere.data,
  ]);

  if (isLoading || !audit) {
    return (
      <div className="placeholder">
        <div className="big">{isLoading ? "Loading…" : "Audit not found"}</div>
        <Link to="/audits">← Audits</Link>
      </div>
    );
  }
  if (audit.status !== "open") {
    return (
      <div className="placeholder">
        <div className="big">This audit is {audit.status}.</div>
        <p className="muted">A wizard records Findings, and a closed audit accepts none.</p>
        <Link to={`/audits/${audit.id}`}>← {audit.name}</Link>
      </div>
    );
  }

  const setAnswer = (tid: string, key: string, v: AnswerValue, mode: AnswerMode = "tap") => {
    const current = answers[tid]?.[key];
    if (mode === "typing") {
      // Held until the field commits, along with what it held on arrival.
      const held = pending.current;
      pending.current =
        held && held.tid === tid && held.key === key ? { ...held, v } : { tid, key, v, from: current };
      setAnswers((prev) => ({ ...prev, [tid]: { ...(prev[tid] ?? {}), [key]: v } }));
      return;
    }
    const held = pending.current;
    const from = held && held.tid === tid && held.key === key ? held.from : current;
    pending.current = null;
    setAnswers((prev) => ({ ...prev, [tid]: { ...(prev[tid] ?? {}), [key]: v } }));
    // A field the run merely landed on and left again is not an answer.
    // The first write at a location creates its Finding, and a Finding is
    // what marks it audited - so scrolling past must write nothing.
    if (mode === "commit" && sameAnswer(v, from)) return;
    setTouched((prev) => new Set(prev).add(`${tid}|${key}`));
    write(tid, key, v);
  };

  const write = (tid: string, key: string, v: AnswerValue) => {
    const target = walked.find((x) => x.id === tid);
    const item = itemsForTarget(groups, selection, target!).find((i) => i.key === key);
    if (!target || !item || !current.user) return;
    setError(null);
    void recordWizardItem({
      auditId: audit.id,
      auditKind: audit.kind,
      targetId: tid,
      locationId: target.location_id,
      locationName: target.location_name,
      item,
      value: v,
      actorId: current.user.id,
      // With a confirmation page in the run, the Finding this creates is
      // work in progress: the location stays in the queue until the
      // auditor reaches that page and says otherwise.
      confirms: selection.has(CONFIRM_KEY),
      expected: {
        hasCurrentLease: leases.some(
          (l) => (!l.start_date || new Date(l.start_date).getTime() <= Date.now()) && (!l.end_date || new Date(l.end_date).getTime() >= Date.now()),
        ),
        hasActiveReservation: reservations.some((r) => r.status === "checked_in"),
      },
    })
      .then(async (findingId) => {
        // A Yes/No question that raises a ticket on No does so here, the
        // same as the Finding form - once, and only while the answer is No.
        if (item.kind !== "question" || !item.ticketOnNo || v !== false || !target.location_id) return;
        const open = ticketStatuses.find((s) => s.is_terminal === 0) ?? ticketStatuses[0];
        if (!open) return;
        await createTicket(
          {
            title: item.label,
            priority: "medium",
            target: { type: "location", id: target.location_id, label: target.location_name },
            statusId: open.id,
            sourceFindingId: findingId,
          },
          current.user?.id ?? null,
        );
      })
      .catch((e: unknown) => setError((e as { message?: string }).message ?? String(e)));
  };

  if (phase === "setup") {
    return (
      <SetupScreen
        auditId={audit.id}
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
          setRunTargets(shownTargets);
          setPhase("run");
        }}
      />
    );
  }

  const props: RunProps = {
    auditName: audit.name,
    targets: walked,
    steps,
    index: Math.min(index, Math.max(0, steps.length - 1)),
    setIndex: (i: number) => {
      // Leaving an item writes whatever was being typed into it.
      flush();
      setIndex(i);
    },
    answers,
    setAnswer,
    itemsFor: (t) => itemsForTarget(groups, selection, t),
    reviewItems: (t) => itemsForTarget(groups, allKeys(groups), t),
    confirmedAt: (tid) => confirmedAt.get(tid) ?? null,
    statuses: statuses.map((s) => ({ id: s.id, name: s.name })),
    onFile,
    answeredTarget,
    touched: (tid, key) => touched.has(`${tid}|${key}`),
    savedNote: error ?? "Saved as you go",
    onExit: () => {
      flush();
      navigate(`/audits/${audit.id}`);
    },
  };
  return <WizardRun {...props} />;
}

/** A Proposal's payload: jsonb in Postgres, TEXT on the device. */
function parsePayload(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A question's answer as stored: JSON, so `false` survives the round trip
 *  and a choice is a string rather than a number that looks like one. */
function parseAnswer(raw: string): AnswerValue {
  try {
    return JSON.parse(raw) as AnswerValue;
  } catch {
    return raw;
  }
}

function SetupScreen({
  auditId,
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
  auditId: string;
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
        <Link to={`/audits/${auditId}`} className="btn btn-sm btn-bare">
          ✕ Exit
        </Link>
        <span className="muted small">{auditName}</span>
        <span />
      </div>
      <div className="wz-body">
        <div className="wz-setup">
          <p className="muted">What are you checking on this run?</p>
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
