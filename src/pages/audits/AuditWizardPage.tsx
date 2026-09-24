import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useAudit, useAuditQuestions, useAuditTargets } from "../../data/audits";
import { recordWizardItem, useAuditFindingTargets, useAuditTargetQuestions } from "../../data/auditWizard";
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
  buildSteps,
  itemsForTarget,
  type Answers,
  type AnswerValue,
  type ItemGroup,
  type WizardItem,
  type WizardTarget,
} from "../../lib/auditWizard";
import { WizardRun } from "./wizard/WizardRun";
import type { RunProps } from "./wizard/runProps";
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
  /** A value being typed in, not yet written. */
  const pending = useRef<{ tid: string; key: string; v: AnswerValue } | null>(null);

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

  const withFinding = useMemo(() => new Set(findingTargets.map((f) => f.target_id)), [findingTargets]);
  const answeredTarget = (targetId: string) =>
    withFinding.has(targetId) || [...touched].some((t) => t.startsWith(`${targetId}|`));

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

  const walked = runTargets ?? shownTargets;
  const flush = () => {
    const held = pending.current;
    pending.current = null;
    if (held) write(held.tid, held.key, held.v);
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
  const settled = [locServices, locAmenities, locAttributes].every((q) => !q.isLoading && !q.isFetching);
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

  // Seed this location's answers once, from what is on file. Both flags,
  // because a PowerSync query keeps its previous data across a parameter
  // change with isLoading still false (CLAUDE.md).
  const [seeded, setSeeded] = useState<Set<string>>(new Set());
  const targetId = current_?.target.id;
  useEffect(() => {
    if (!targetId || !current_ || !settled || seeded.has(targetId)) return;
    const items = itemsForTarget(groups, selection, current_.target);
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
  }, [targetId, current_, settled, seeded, groups, selection, locServices.data, locAmenities.data, locAttributes.data]);

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

  const setAnswer = (tid: string, key: string, v: AnswerValue, immediate = true) => {
    setAnswers((prev) => ({ ...prev, [tid]: { ...(prev[tid] ?? {}), [key]: v } }));
    setTouched((prev) => new Set(prev).add(`${tid}|${key}`));
    if (!immediate) {
      // Being typed in. Held until the field commits, or until the run
      // leaves the item - whichever comes first.
      pending.current = { tid, key, v };
      return;
    }
    pending.current = null;
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
