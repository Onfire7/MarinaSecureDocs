import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { deterministicId } from "../../lib/detId";
import {
  doorCheckSummary,
  doorStateLabel,
  questionAnswerSummary,
  STATE_CHECK_KINDS,
} from "../../lib/checklists";
import {
  buildInstanceTx,
  TEMPLATE_INSTANTIATION_QUERY,
} from "../../lib/checklistInstantiation";
import type {
  DoorCheckConfig,
  QuestionAnswerType,
  QuestionConfig,
  QuestionResult,
  DoorCheckResult,
  DoorState,
  StateCheckType,
  ItemResult,
  LocationCheckConfig,
  MeterReadingConfig,
  VerifyTaskConfig,
} from "../../lib/checklists";

/** The pinned template item behind a row: what the guard is being asked. */
export interface ItemSpec {
  id: string;
  type: string;
  label: string;
  config?: Record<string, unknown> | null;
}

/** The materialized instance-item row being answered. */
export interface InstanceItemRow {
  id: string;
  result?: Record<string, unknown> | null;
  note?: string | null;
  completedAt?: number | string | null;
  completedBy?: { id: string } | null;
}

export interface ItemProps {
  item: ItemSpec;
  /** Always present now — instance items exist as rows from the moment
   *  they're assigned. The name survives from when result rows were only
   *  created on first answer. */
  existing: InstanceItemRow;
  /** The parent checklist instance — nested sub-checklists hang off it. */
  checklistId: string;
  onSaved: (result: ItemResult, ticketId?: string) => void;
  /** False for read-only viewers — finished items lose their Edit affordance. */
  editable?: boolean;
}

async function saveResult(row: InstanceItemRow, result: ItemResult, userId?: string) {
  await db.transact(
    db.tx.checklistInstanceItems[row.id]
      .update({
        result: result as unknown as Record<string, unknown>,
        completedAt: Date.now(),
      })
      .link(userId ? { completedBy: userId } : {}),
  );
}

async function clearResult(row: InstanceItemRow) {
  // The row is the assignment, not the answer — clearing an answer resets
  // its fields rather than deleting the row.
  await db.transact([
    db.tx.checklistInstanceItems[row.id].update({ result: null, completedAt: null }),
    ...(row.completedBy
      ? [
          db.tx.checklistInstanceItems[row.id].unlink({
            completedBy: row.completedBy.id,
          }),
        ]
      : []),
  ]);
}

/**
 * A finished item, with the Edit affordance that reopens it. Editing is only
 * offered before the checklist is submitted — afterwards the item is part of
 * a completed record, and its incidents and tickets actually exist.
 */
function DoneCard({
  title,
  summary,
  tone = "done",
  onEdit,
}: {
  title: string;
  summary?: ReactNode;
  tone?: "done" | "plain";
  onEdit?: () => void;
}) {
  return (
    <div className={"card" + (tone === "done" ? " card-done" : "")}>
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="card-title">{title}</div>
          {summary && <div className="card-meta">{summary}</div>}
        </div>
        {onEdit && (
          <button type="button" className="btn btn-sm btn-quiet" onClick={onEdit}>
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Simple Check

export function SimpleCheckItem({
  item,
  existing,
  onSaved,
  editable = true,
}: ItemProps) {
  const current = useCurrent();
  const done = existing.result != null;
  const complete = async () => {
    const result: ItemResult = { type: "simple_check", completedAt: Date.now() };
    await saveResult(existing, result, current.user?.id);
    onSaved(result);
  };

  if (done) {
    return (
      <DoneCard
        title={item.label}
        summary="✓ Complete"
        // "Complete" is this item's only state, so editing it can only mean
        // undoing it — there's no form to reopen.
        onEdit={editable ? () => void clearResult(existing) : undefined}
      />
    );
  }
  return (
    <div className="card">
      <div className="card-title">{item.label}</div>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-primary" onClick={() => void complete()}>
          ✓ Mark complete
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Verify Task

export function VerifyTaskItem({
  item,
  existing,
  onSaved,
  editable = true,
}: ItemProps) {
  const current = useCurrent();
  const cfg = (item.config ?? {}) as unknown as VerifyTaskConfig;
  const existingResult = existing.result as
    | Extract<ItemResult, { type: "verify_task" }>
    | undefined;
  const [stage, setStage] = useState<"initial" | "attempt" | "reason">("initial");
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState(false);
  const done = existingResult != null && !editing;

  const finish = async (
    outcome: "confirmed" | "rejected_reason" | "rejected_ticket",
    attempted?: boolean,
  ) => {
    // The ticket is described now and written at submit, so changing this
    // answer beforehand doesn't leave a stray ticket behind.
    const ticketId = outcome === "rejected_ticket" ? id() : undefined;
    const result: ItemResult = {
      type: "verify_task",
      outcome,
      attempted,
      ...(outcome === "rejected_reason" ? { reason } : {}),
      ...(ticketId
        ? {
            pendingTicket: {
              id: ticketId,
              title: `Failed Verify Task: ${item.label}`,
              openedAt: Date.now(),
              priority: "medium",
              autoGenerated: false,
            },
          }
        : {}),
    };
    await saveResult(existing, result, current.user?.id);
    setEditing(false);
    setStage("initial");
    onSaved(result, ticketId);
  };

  const clickReject = () => {
    if (cfg.requireAttemptBeforeReject && stage === "initial") setStage("attempt");
    else setStage("reason");
  };

  if (done) {
    return (
      <DoneCard
        title={item.label}
        summary={verifyOutcomeLabel(existingResult)}
        onEdit={
          editable
            ? () => {
                setReason(existingResult.reason ?? "");
                setStage("initial");
                setEditing(true);
              }
            : undefined
        }
      />
    );
  }

  return (
    <div className="card">
      <div className="card-title">{item.label}</div>

      {stage === "initial" && (
        <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void finish("confirmed")}
          >
            Confirm
          </button>
          <button type="button" className="btn" onClick={clickReject}>
            Reject — reason
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void finish("rejected_ticket")}>
            Reject — raise ticket
          </button>
        </div>
      )}

      {stage === "attempt" && (
        <div style={{ marginTop: 10 }}>
          <p className="muted small">
            Attempt the task yourself before finalizing a rejection.
          </p>
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void finish("confirmed", true)}
            >
              I did it — Confirm
            </button>
            <button type="button" className="btn btn-danger" onClick={() => setStage("reason")}>
              Still rejecting
            </button>
          </div>
        </div>
      )}

      {stage === "reason" && (
        <div style={{ marginTop: 10 }}>
          <div className="field">
            <span className="field-label">Reason</span>
            <textarea
              className="textarea"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!reason.trim()}
              onClick={() => void finish("rejected_reason")}
            >
              Reject with reason
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setStage("initial")}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function verifyOutcomeLabel(r: Extract<ItemResult, { type: "verify_task" }>): string {
  if (r.outcome === "confirmed") return r.attempted ? "Confirmed (after attempt)" : "Confirmed";
  if (r.outcome === "rejected_reason") return `Rejected — ${r.reason ?? "reason given"}`;
  return "Rejected — ticket raised";
}

// ---------------------------------------------------- Door / Lock checks

/**
 * Records a physical thing's state as *found* and as *left*, separately.
 * Only the pair supports the questions the reports need — "was this actually
 * secure overnight?" and, separately, "did the guard put it right?" — which a
 * single observed state silently conflated.
 *
 * A door and a bare lock are the same check with different vocabularies: a
 * padlocked gate, a fuel pump, a shed hasp has no "open" state, only locked
 * or unlocked. Rather than fork the flow, the
 * allowed states come from STATE_CHECK_KINDS, so adding another such thing
 * later is a table entry rather than another copy of this component.
 *
 * Found-as-expected is the overwhelmingly common case and stays one tap: the
 * final state is implied and the second row of buttons never appears. A
 * mismatch is the exceptional path, and the one worth slowing down — it
 * raises an incident (it was wrong before anyone touched it, which is true
 * regardless of what happens next) and then asks what state it was left in.
 */
function StateCheckItem({
  kind,
  item,
  existing,
  onSaved,
  editable = true,
}: ItemProps & { kind: StateCheckType }) {
  const current = useCurrent();
  const spec = STATE_CHECK_KINDS[kind];
  const cfg = (item.config ?? {}) as unknown as DoorCheckConfig;
  // An item whose config was never opened in the template builder persists as
  // `{}`; fall back to the same default the builder displays rather than
  // crashing on an undefined state.
  // Two states now: the one it should be found in, and the one it should be
  // left in. Rows written before they were separated carry a single value
  // plus a flag, and are read back as the pair that stood for — so an
  // unmigrated item behaves exactly as it was authored.
  const legacy = cfg.finalState == null;
  const finalTarget: DoorState =
    cfg.finalState ?? cfg.expectedState ?? spec.defaultState;
  const expectedState: DoorState | undefined = legacy
    ? cfg.finalStateOnly === true
      ? undefined
      : (cfg.expectedState ?? spec.defaultState)
    : cfg.expectedState;
  // No found expectation means no found question, and so no found-state
  // incident — only the left state matters.
  const finalOnly = expectedState == null;
  const existingResult = existing.result as DoorCheckResult | undefined;

  const [initialState, setInitialState] = useState<DoorState | null>(null);
  // Found in the expected state, now being asked what it's being left in —
  // no incident, because nothing was wrong when they arrived.
  const [foundState, setFoundState] = useState<DoorState | null>(null);
  const [pendingFinal, setPendingFinal] = useState<DoorState | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  // Preserved across an edit so re-answering doesn't restamp the finding to
  // the time it was corrected.
  const openedAtRef = useRef<number | null>(null);
  const done = existingResult != null && !editing;

  // The bound Location is the incident's attachment target. It's required by
  // the template builder, so the guard is never asked to choose one — that
  // question belongs to whoever authored the template, not to someone
  // standing at a door at 2am.
  const { data: boundData } = db.useQuery(
    cfg.locationId ? { locations: { $: { where: { id: cfg.locationId } } } } : null,
  );
  const boundLocation = boundData?.locations?.[0];

  const beginMismatch = (found: DoorState) => {
    setInitialState(found);
    openedAtRef.current ??= Date.now();
    setTitle(`${item.label} found ${stateLabel(found).toLowerCase()}`);
    setDetails(
      `Expected ${stateLabel(expectedState ?? finalTarget).toLowerCase()}, ` +
        `found ${stateLabel(found).toLowerCase()}.`,
    );
  };

  const selectInitial = async (found: DoorState) => {
    if (found !== expectedState) {
      beginMismatch(found);
      return;
    }
    // Found as expected, but not necessarily meant to stay that way — a door
    // expected unlocked on arrival and locked on departure is found right and
    // still has to be answered for. Only skip the second question when the
    // two states agree, which is every item that existed before they could
    // differ.
    if (found !== finalTarget) {
      setFoundState(found);
      openedAtRef.current ??= Date.now();
      return;
    }
    const result: ItemResult = {
      type: kind,
      expected: expectedState,
      initialState: found,
      finalState: found,
    };
    await saveResult(existing, result, current.user?.id);
    setEditing(false);
    setInitialState(null);
    onSaved(result);
  };

  // The incident and any ticket are only *described* here; they're written
  // when the checklist is submitted (see lib/checklistSubmit.ts). That's what
  // lets the guard reopen this item and change their answer without the app
  // having to retract a real Incident.
  const commitMismatch = async (finalState: DoorState, raiseTicket: boolean) => {
    if (!initialState || saving) return;
    setSaving(true);
    try {
      const openedAt = openedAtRef.current ?? Date.now();
      const incidentId = existingResult?.pendingIncident?.id ?? id();
      const ticketId = raiseTicket
        ? (existingResult?.pendingTicket?.id ?? id())
        : undefined;
      const summary =
        `${item.label}: found ${stateLabel(initialState).toLowerCase()}, ` +
        `left ${stateLabel(finalState).toLowerCase()} ` +
        `(expected ${stateLabel(expectedState ?? finalTarget).toLowerCase()})`;
      const result: ItemResult = {
        type: kind,
        expected: expectedState ?? finalTarget,
        initialState,
        finalState,
        ...(details.trim() ? { note: details.trim() } : {}),
        pendingIncident: {
          id: incidentId,
          title: title.trim() || summary,
          details: details.trim() || undefined,
          openedAt,
          ...(boundLocation
            ? {
                target: {
                  type: "location",
                  id: boundLocation.id,
                  label: boundLocation.name,
                },
              }
            : {}),
        },
        ...(ticketId
          ? {
              pendingTicket: {
                id: ticketId,
                title: `${capitalizeFirst(spec.noun)} left ${stateLabel(finalState).toLowerCase()}: ${item.label}`,
                description: summary,
                openedAt,
                priority: "medium",
                autoGenerated: false,
                sourceIncidentId: incidentId,
              },
            }
          : {}),
      };
      await saveResult(existing, result, current.user?.id);
      setEditing(false);
      setInitialState(null);
      setPendingFinal(null);
      onSaved(result, ticketId);
    } finally {
      setSaving(false);
    }
  };

  const chooseFinal = (finalState: DoorState) => {
    if (finalState === finalTarget) {
      // Put right — no ticket to offer, so don't ask.
      void commitMismatch(finalState, false);
      return;
    }
    setPendingFinal(finalState);
  };

  // finalStateOnly items have no found state to compare, so there's never an
  // incident — only a ticket, and only if the left state still isn't right.
  const commitFinalOnly = async (finalState: DoorState, raiseTicket: boolean) => {
    if (saving) return;
    setSaving(true);
    try {
      const openedAt = openedAtRef.current ?? Date.now();
      const ticketId = raiseTicket
        ? (existingResult?.pendingTicket?.id ?? id())
        : undefined;
      const summary =
        `${item.label}: left ${stateLabel(finalState).toLowerCase()} ` +
        `(expected ${stateLabel(finalTarget).toLowerCase()})`;
      const result: ItemResult = {
        type: kind,
        expected: finalTarget,
        finalState,
        ...(foundState ? { initialState: foundState } : {}),
        ...(ticketId
          ? {
              pendingTicket: {
                id: ticketId,
                title: `${capitalizeFirst(spec.noun)} left ${stateLabel(finalState).toLowerCase()}: ${item.label}`,
                description: summary,
                openedAt,
                priority: "medium",
                autoGenerated: false,
              },
            }
          : {}),
      };
      await saveResult(existing, result, current.user?.id);
      setEditing(false);
      setPendingFinal(null);
      setFoundState(null);
      onSaved(result, ticketId);
    } finally {
      setSaving(false);
    }
  };

  const chooseFinalOnly = (finalState: DoorState) => {
    if (finalState === finalTarget) {
      void commitFinalOnly(finalState, false);
      return;
    }
    openedAtRef.current ??= Date.now();
    setPendingFinal(finalState);
  };

  if (done) {
    const s = doorCheckSummary(existingResult);
    return (
      <DoneCard
        title={item.label}
        summary={doneSummaryText(s)}
        tone={s.leftAsExpected ? "done" : "plain"}
        onEdit={
          editable
            ? () => {
                // Reopen prefilled from what was recorded, so a correction is
                // an adjustment rather than starting over.
                const prev = existingResult.pendingIncident;
                openedAtRef.current = prev?.openedAt ?? null;
                setInitialState(s.initial ?? null);
                setFoundState(null);
                setTitle(prev?.title ?? "");
                setDetails(prev?.details ?? existingResult.note ?? "");
                setPendingFinal(null);
                setEditing(true);
              }
            : undefined
        }
      />
    );
  }

  // Mismatch flow: incident details, then the second row of buttons.
  if (initialState) {
    return (
      <div className="card">
        <div className="card-title">{item.label}</div>
        <div className="badge badge-bad" style={{ margin: "8px 0", display: "block" }}>
          Found {stateLabel(initialState).toLowerCase()} — expected{" "}
          {stateLabel(expectedState ?? finalTarget).toLowerCase()}. This is logged
          as an incident
          {boundLocation ? ` on ${boundLocation.name}` : ""}.
        </div>

        <div className="field">
          <span className="field-label">Incident title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <span className="field-label">Details</span>
          <textarea
            className="textarea"
            rows={2}
            value={details}
            onChange={(e) => setDetails(e.target.value)}
          />
        </div>
        {!boundLocation && (
          <div className="badge badge-warn" style={{ display: "block", marginBottom: 10 }}>
            This {spec.noun} has no location set in its template, so the incident
            won't be attached to one. Ask an admin to set it.
          </div>
        )}

        <div className="field-label" style={{ marginTop: 4 }}>
          What state did you leave it in?
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {spec.states.map((s) => (
            <button
              key={s}
              type="button"
              className={"btn btn-sm" + (pendingFinal === s ? " btn-primary" : "")}
              disabled={saving}
              onClick={() => chooseFinal(s)}
            >
              {stateLabel(s)}
            </button>
          ))}
        </div>

        {pendingFinal && pendingFinal !== finalTarget && (
          <TicketOfferPrompt
            state={pendingFinal}
            saving={saving}
            onConfirm={(raiseTicket) => void commitMismatch(pendingFinal, raiseTicket)}
          />
        )}
      </div>
    );
  }

  // Found right, now being asked what it's being left in. Same question as
  // the final-only flow and the same commit — the only difference is that the
  // found state is known and gets recorded with it.
  if (foundState) {
    return (
      <div className="card">
        <div className="card-title">{item.label}</div>
        <div className="field-label" style={{ marginTop: 10 }}>
          Found {stateLabel(foundState).toLowerCase()}, as expected. Leave it{" "}
          {stateLabel(finalTarget).toLowerCase()} — what state are you leaving
          it in?
        </div>
        <div className="row" style={{ flexWrap: "wrap", marginTop: 8 }}>
          {spec.states.map((s) => (
            <button
              key={s}
              type="button"
              className={"btn btn-sm" + (pendingFinal === s ? " btn-primary" : "")}
              disabled={saving}
              onClick={() => chooseFinalOnly(s)}
            >
              {stateLabel(s)}
            </button>
          ))}
        </div>
        {pendingFinal && pendingFinal !== finalTarget && (
          <TicketOfferPrompt
            state={pendingFinal}
            saving={saving}
            onConfirm={(raiseTicket) => void commitFinalOnly(pendingFinal, raiseTicket)}
          />
        )}
      </div>
    );
  }

  if (finalOnly) {
    return (
      <div className="card">
        <div className="card-title">{item.label}</div>
        <div className="field-label" style={{ marginTop: 10 }}>
          Expected when left: {stateLabel(finalTarget)} · what state are you
          leaving it in?
        </div>
        <div className="row" style={{ flexWrap: "wrap", marginTop: 8 }}>
          {spec.states.map((s) => (
            <button
              key={s}
              type="button"
              className={"btn btn-sm" + (pendingFinal === s ? " btn-primary" : "")}
              disabled={saving}
              onClick={() => chooseFinalOnly(s)}
            >
              {stateLabel(s)}
            </button>
          ))}
        </div>
        {pendingFinal && pendingFinal !== finalTarget && (
          <TicketOfferPrompt
            state={pendingFinal}
            saving={saving}
            onConfirm={(raiseTicket) => void commitFinalOnly(pendingFinal, raiseTicket)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">{item.label}</div>
      <div className="field-label" style={{ marginTop: 10 }}>
        Expected: {stateLabel(expectedState ?? finalTarget)} · how did you find
        it?
      </div>
      <div className="row" style={{ flexWrap: "wrap", marginTop: 8 }}>
        {spec.states.map((s) => (
          <button key={s} type="button" className="btn btn-sm" onClick={() => void selectInitial(s)}>
            {stateLabel(s)}
          </button>
        ))}
      </div>
    </div>
  );
}

function TicketOfferPrompt({
  state,
  saving,
  onConfirm,
}: {
  state: DoorState;
  saving: boolean;
  onConfirm: (raiseTicket: boolean) => void;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="badge badge-warn" style={{ marginBottom: 8, display: "block" }}>
        Leaving it {stateLabel(state).toLowerCase()} — still not the expected
        state. Raise a ticket so it gets followed up?
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          disabled={saving}
          onClick={() => onConfirm(true)}
        >
          Save &amp; raise a ticket
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={saving}
          onClick={() => onConfirm(false)}
        >
          Save without a ticket
        </button>
      </div>
    </div>
  );
}

export function DoorCheckItem(props: ItemProps) {
  return <StateCheckItem kind="door_check" {...props} />;
}

export function LockCheckItem(props: ItemProps) {
  return <StateCheckItem kind="lock_check" {...props} />;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function doneSummaryText(s: ReturnType<typeof doorCheckSummary>): string | undefined {
  // Historical rows never stored an "as found" state, so say what's actually
  // known rather than implying it was found correct.
  if (!s.foundKnown) {
    if (!s.final) return "Recorded";
    // A routine match needs no explanation; a mismatch is the exceptional
    // case worth surfacing.
    return s.leftAsExpected ? undefined : `${stateLabel(s.final)} — mismatch`;
  }
  // Found-as-expected is the routine outcome — nothing to call out. Anomalies
  // (corrected, or still not as expected) stay visible since they're what a
  // reviewer needs to see.
  if (s.foundAsExpected) return undefined;
  if (s.corrected)
    return `Found ${stateLabel(s.initial!).toLowerCase()} — corrected to ${stateLabel(s.final!).toLowerCase()}`;
  return `Found ${stateLabel(s.initial!).toLowerCase()} — left ${stateLabel(s.final!).toLowerCase()}, still not as expected`;
}

function stateLabel(s: DoorState): string {
  return doorStateLabel(s);
}


// ---------------------------------------------------------------- Location-Based Check

export function LocationCheckItem({ item, existing, checklistId, onSaved }: ItemProps) {
  const cfg = (item.config ?? {}) as unknown as LocationCheckConfig;
  const existingResult = existing.result as
    | Extract<ItemResult, { type: "location_check" }>
    | undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const current = useCurrent();

  const { data: nestedData } = db.useQuery(
    existingResult
      ? { checklistInstances: { $: { where: { id: existingResult.nestedChecklistId } } } }
      : null,
  );
  const { data: locationData } = db.useQuery(
    !existingResult ? { locations: { $: { where: { id: cfg.locationId } } } } : null,
  );
  // The nested template in instantiable shape — its sections and items are
  // materialized as rows the moment the sub-checklist is created.
  const { data: templateData } = db.useQuery(
    !existingResult && cfg.templateId
      ? {
          checklistTemplates: {
            $: { where: { id: cfg.templateId } },
            ...TEMPLATE_INSTANTIATION_QUERY,
          },
        }
      : null,
  );
  const template = templateData?.checklistTemplates?.[0];
  const nested = nestedData?.checklistInstances?.[0];
  const locationName = locationData?.locations?.[0]?.name;
  const nestedComplete = nested?.status === "complete";

  const open = async () => {
    let nestedId = existingResult?.nestedChecklistId;
    if (!nestedId) {
      if (!template || !current.user) return;
      nestedId = deterministicId(`location-check:${checklistId}:${existing.id}`);
      await db.transact([
        ...buildInstanceTx({ template, instanceId: nestedId, userId: current.user.id }),
        // Whoever opened it works it, whatever the template's assignment
        // says — and parentItem keeps it out of the main checklist list.
        db.tx.checklistInstances[nestedId].link({
          assignedTo: current.user.id,
          parentItem: existing.id,
        }),
        // No completedAt here — the sub-checklist's own submit sets it, so
        // section completion times reflect when the work truly finished.
        db.tx.checklistInstanceItems[existing.id].update({
          result: { type: "location_check", nestedChecklistId: nestedId },
        }),
      ]);
      onSaved({ type: "location_check", nestedChecklistId: nestedId });
    }
    navigate(`/checklists/${nestedId}`, { state: { returnTo: location.pathname } });
  };

  return (
    <div className={"card" + (nestedComplete ? " card-done" : "")}>
      <div className="card-title">{item.label}</div>
      <div className="card-meta">
        {locationName ? `Scoped to ${locationName}` : "Opens a nested sub-checklist"}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="btn" onClick={() => void open()}>
          {existingResult ? (nestedComplete ? "View nested checklist" : "Resume nested checklist") : "Open nested checklist"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Meter Reading

export function MeterReadingItem({
  item,
  existing,
  onSaved,
  editable = true,
}: ItemProps) {
  const current = useCurrent();
  const cfg = (item.config ?? {}) as unknown as MeterReadingConfig;
  const existingResult = existing.result as
    | Extract<ItemResult, { type: "meter_reading" }>
    | undefined;
  const [assetId, setAssetId] = useState(cfg.assetId ?? "");
  const [value, setValue] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [editing, setEditing] = useState(false);
  const openedAtRef = useRef<number | null>(null);

  const { data } = db.useQuery(
    cfg.assetId
      ? { assets: { $: { where: { id: cfg.assetId } } } }
      : { assets: { $: { where: { hasMeter: true } } } },
  );
  const options = cfg.assetId ? [] : data?.assets ?? [];
  const asset = cfg.assetId ? data?.assets?.[0] : options.find((a) => a.id === assetId);

  const done = existingResult != null && !editing;
  const needsCorrection =
    asset?.meterReading != null && Number(value) < asset.meterReading && value !== "";

  // The reading, the Asset's meter bump, and any maintenance tickets it
  // triggers are all deferred to submit. Writing them here would bump the
  // asset off a number the guard can still correct, and would evaluate
  // maintenance rules against a value that isn't final yet.
  const record = async () => {
    if (!asset) return;
    const numeric = Number(value);
    const readingId = existingResult?.pendingReading?.id ?? id();
    const openedAt = openedAtRef.current ?? Date.now();
    const result: ItemResult = {
      type: "meter_reading",
      assetId: asset.id,
      value: numeric,
      meterReadingId: readingId,
      pendingReading: {
        id: readingId,
        assetId: asset.id,
        value: numeric,
        openedAt,
        ...(needsCorrection && correctionReason ? { correctionReason } : {}),
      },
    };
    await saveResult(existing, result, current.user?.id);
    setEditing(false);
    onSaved(result);
  };

  if (done) {
    return (
      <DoneCard
        title={item.label}
        summary={`Recorded ${existingResult.value}`}
        onEdit={
          editable
            ? () => {
                openedAtRef.current = existingResult.pendingReading?.openedAt ?? null;
                setAssetId(existingResult.assetId);
                setValue(String(existingResult.value));
                setCorrectionReason(existingResult.pendingReading?.correctionReason ?? "");
                setEditing(true);
              }
            : undefined
        }
      />
    );
  }

  return (
    <div className="card">
      <div className="card-title">{item.label}</div>

      {!cfg.assetId && (
        <div className="field">
          <span className="field-label">Asset</span>
          <select className="select" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">Select…</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <span className="field-label">
          Reading{asset?.meterReading != null ? ` (current: ${asset.meterReading})` : ""}
        </span>
        <input
          className="input"
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      {needsCorrection && (
        <div className="field">
          <span className="field-label">
            Correction reason — required (reading is lower than the last one)
          </span>
          <textarea
            className="textarea"
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
            rows={2}
          />
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!asset || value === "" || (needsCorrection && !correctionReason.trim())}
          onClick={() => void record()}
        >
          Record reading
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Question

/**
 * A free-form question, answered in whichever shape the template asked for.
 *
 * The answer type is copied onto the result at answer time: a template edited
 * later must not change how an answer already given is read back.
 */
export function QuestionItem({
  item,
  existing,
  onSaved,
  editable = true,
}: ItemProps) {
  const current = useCurrent();
  const cfg = (item.config ?? {}) as unknown as QuestionConfig;
  const answerType: QuestionAnswerType = cfg.answerType ?? "single_line";
  const detailsOn = cfg.detailsOn ?? "none";
  const step = cfg.step && cfg.step > 0 ? cfg.step : 1;
  const previous = existing.result as QuestionResult | undefined;

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(previous?.text ?? "");
  // Always one empty box to type into, and never fewer boxes than answers.
  const [lines, setLines] = useState<string[]>(
    previous?.lines?.length ? previous.lines : [""],
  );
  const [value, setValue] = useState<string>(
    previous?.value != null ? String(previous.value) : "0",
  );
  const [yes, setYes] = useState<boolean | null>(previous?.yes ?? null);
  const [details, setDetails] = useState(previous?.details ?? "");
  const [saving, setSaving] = useState(false);

  const done = previous != null && !editing;
  const detailsWanted =
    yes === null
      ? false
      : detailsOn === "both" || (yes ? detailsOn === "yes" : detailsOn === "no");

  const save = async (over?: Partial<QuestionResult>) => {
    if (saving) return;
    setSaving(true);
    try {
      const base: QuestionResult = { type: "question", answerType };
      if (answerType === "single_line" || answerType === "multi_line")
        base.text = text.trim();
      if (answerType === "repeatable_line")
        base.lines = lines.map((l) => l.trim()).filter(Boolean);
      if (answerType === "number") base.value = Number(value);
      if (answerType === "yes_no") {
        base.yes = yes ?? false;
        if (detailsWanted && details.trim()) base.details = details.trim();
      }
      const result: ItemResult = { ...base, ...over };
      await saveResult(existing, result, current.user?.id);
      setEditing(false);
      onSaved(result);
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <DoneCard
        title={item.label}
        summary={questionAnswerSummary(previous)}
        tone="done"
        onEdit={editable ? () => setEditing(true) : undefined}
      />
    );
  }

  const nudge = (by: number) => {
    const n = Number(value);
    setValue(String((Number.isFinite(n) ? n : 0) + by));
  };

  return (
    <div className="card">
      <div className="card-title">{item.label}</div>

      {answerType === "single_line" && (
        <input
          className="input"
          style={{ marginTop: 10 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}

      {answerType === "multi_line" && (
        <textarea
          className="textarea"
          style={{ marginTop: 10 }}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}

      {/* One box per answer, each independent: a new line appears beneath
          rather than anywhere near what's already been written, so adding to
          the list later can't disturb an earlier entry. */}
      {answerType === "repeatable_line" && (
        <div className="stack" style={{ gap: 6, marginTop: 10 }}>
          {lines.map((line, i) => (
            <input
              key={i}
              className="input"
              value={line}
              aria-label={`Line ${i + 1}`}
              onChange={(e) =>
                setLines((prev) => prev.map((l, j) => (j === i ? e.target.value : l)))
              }
            />
          ))}
          <div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setLines((prev) => [...prev, ""])}
            >
              + Add another line
            </button>
          </div>
        </div>
      )}

      {/* Big targets either side of a small field: this is for counting
          things on the move, where the number moves by one far more often
          than it gets typed. */}
      {answerType === "number" && (
        <div className="row" style={{ marginTop: 10, gap: 10 }}>
          <button
            type="button"
            className="btn btn-step"
            aria-label={`Down ${step}`}
            onClick={() => nudge(-step)}
          >
            −
          </button>
          <input
            className="input"
            style={{ width: 90, textAlign: "center" }}
            inputMode="numeric"
            value={value}
            aria-label="Value"
            onChange={(e) => {
              // Digits and one leading minus only — a numeric field that
              // accepts "12e4" is a numeric field that reports nonsense.
              const next = e.target.value.replace(/(?!^-)[^0-9]/g, "");
              setValue(next);
            }}
          />
          <button
            type="button"
            className="btn btn-step"
            aria-label={`Up ${step}`}
            onClick={() => nudge(step)}
          >
            +
          </button>
        </div>
      )}

      {answerType === "yes_no" && (
        <>
          <div className="row" style={{ marginTop: 10, gap: 8 }}>
            {[true, false].map((v) => (
              <button
                key={String(v)}
                type="button"
                className={"btn" + (yes === v ? " btn-primary" : "")}
                onClick={() => setYes(v)}
              >
                {v ? "Yes" : "No"}
              </button>
            ))}
          </div>
          {detailsWanted && (
            <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
              <span className="field-label">Provide Details</span>
              <textarea
                className="textarea"
                rows={2}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
              />
            </div>
          )}
        </>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || (answerType === "yes_no" && yes === null)}
          onClick={() => void save()}
        >
          Save answer
        </button>
      </div>
    </div>
  );
}
