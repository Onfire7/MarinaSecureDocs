import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { InstaQLEntity } from "@instantdb/react";
import { db, id, type AppSchema } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { deterministicId } from "../../lib/detId";
import { doorCheckSummary, doorStateLabel, STATE_CHECK_KINDS } from "../../lib/checklists";
import type {
  DoorCheckConfig,
  DoorCheckResult,
  DoorState,
  StateCheckType,
  ItemResult,
  LocationCheckConfig,
  MeterReadingConfig,
  VerifyTaskConfig,
} from "../../lib/checklists";

type TemplateItem = InstaQLEntity<AppSchema, "checklistTemplateItems">;
type ItemResultEntity = InstaQLEntity<
  AppSchema,
  "checklistItemResults",
  { linkedTicket: object }
>;

export interface ItemProps {
  item: TemplateItem;
  existing: ItemResultEntity | undefined;
  checklistId: string;
  onSaved: (result: ItemResult, ticketId?: string) => void;
  /** False once the checklist is submitted — finished items become read-only. */
  editable?: boolean;
}

async function saveResult(
  checklistId: string,
  itemId: string,
  existingId: string | undefined,
  result: ItemResult,
) {
  const resultId = existingId ?? id();
  // Reusing the existing row id means re-answering an item overwrites its
  // result rather than stacking a second one beside it.
  await db.transact(
    db.tx.checklistItemResults[resultId]
      .update({ result: result as unknown as Record<string, unknown>, completedAt: Date.now() })
      .link({ checklist: checklistId, templateItem: itemId }),
  );
}

async function clearResult(existingId: string | undefined) {
  if (!existingId) return;
  await db.transact(db.tx.checklistItemResults[existingId].delete());
}

/**
 * A finished item, with the Edit affordance that reopens it. Editing is only
 * offered before the checklist is submitted — afterwards the item is part of
 * a completed record, and its incidents and tickets actually exist.
 */
function DoneCard({
  badge,
  title,
  summary,
  tone = "done",
  onEdit,
}: {
  badge: string;
  title: string;
  summary: ReactNode;
  tone?: "done" | "plain";
  onEdit?: () => void;
}) {
  return (
    <div className={"card" + (tone === "done" ? " card-done" : "")}>
      <div className="spread" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="badge">{badge}</div>
          <div className="card-title">{title}</div>
          <div className="card-meta">{summary}</div>
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
  checklistId,
  onSaved,
  editable = true,
}: ItemProps) {
  const done = existing?.result != null;
  const complete = async () => {
    const result: ItemResult = { type: "simple_check", completedAt: Date.now() };
    await saveResult(checklistId, item.id, existing?.id, result);
    onSaved(result);
  };

  if (done) {
    return (
      <DoneCard
        badge="Simple Check"
        title={item.label}
        summary="✓ Complete"
        // "Complete" is this item's only state, so editing it can only mean
        // undoing it — there's no form to reopen.
        onEdit={editable ? () => void clearResult(existing?.id) : undefined}
      />
    );
  }
  return (
    <div className="card">
      <div className="badge">Simple Check</div>
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
  checklistId,
  onSaved,
  editable = true,
}: ItemProps) {
  const cfg = (item.config ?? {}) as unknown as VerifyTaskConfig;
  const existingResult = existing?.result as
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
    await saveResult(checklistId, item.id, existing?.id, result);
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
        badge="Verify Task"
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
      <div className="badge">Verify Task</div>
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
  checklistId,
  onSaved,
  editable = true,
}: ItemProps & { kind: StateCheckType }) {
  const spec = STATE_CHECK_KINDS[kind];
  const cfg = (item.config ?? {}) as unknown as DoorCheckConfig;
  // An item whose config was never opened in the template builder persists as
  // `{}`; fall back to the same default the builder displays rather than
  // crashing on an undefined state.
  const expectedState: DoorState = cfg.expectedState ?? spec.defaultState;
  const existingResult = existing?.result as DoorCheckResult | undefined;

  const [initialState, setInitialState] = useState<DoorState | null>(null);
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
      `Expected ${stateLabel(expectedState).toLowerCase()}, ` +
        `found ${stateLabel(found).toLowerCase()}.`,
    );
  };

  const selectInitial = async (found: DoorState) => {
    if (found !== expectedState) {
      beginMismatch(found);
      return;
    }
    // Found as expected: nothing to correct, so the final state is the same
    // state and the guard is never asked a second question.
    const result: ItemResult = {
      type: kind,
      expected: expectedState,
      initialState: found,
      finalState: found,
    };
    await saveResult(checklistId, item.id, existing?.id, result);
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
        `(expected ${stateLabel(expectedState).toLowerCase()})`;
      const result: ItemResult = {
        type: kind,
        expected: expectedState,
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
      await saveResult(checklistId, item.id, existing?.id, result);
      setEditing(false);
      setInitialState(null);
      setPendingFinal(null);
      onSaved(result, ticketId);
    } finally {
      setSaving(false);
    }
  };

  const chooseFinal = (finalState: DoorState) => {
    if (finalState === expectedState) {
      // Put right — no ticket to offer, so don't ask.
      void commitMismatch(finalState, false);
      return;
    }
    setPendingFinal(finalState);
  };

  if (done) {
    const s = doorCheckSummary(existingResult);
    return (
      <DoneCard
        badge={spec.label}
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
        <div className="badge">{spec.label}</div>
        <div className="card-title">{item.label}</div>
        <div className="badge badge-bad" style={{ margin: "8px 0", display: "block" }}>
          Found {stateLabel(initialState).toLowerCase()} — expected{" "}
          {stateLabel(expectedState).toLowerCase()}. This is logged as an incident
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

        {pendingFinal && pendingFinal !== expectedState && (
          <div style={{ marginTop: 10 }}>
            <div className="badge badge-warn" style={{ marginBottom: 8, display: "block" }}>
              Leaving it {stateLabel(pendingFinal).toLowerCase()} — still not the
              expected state. Raise a ticket so it gets followed up?
            </div>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={saving}
                onClick={() => void commitMismatch(pendingFinal, true)}
              >
                Save &amp; raise a ticket
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={saving}
                onClick={() => void commitMismatch(pendingFinal, false)}
              >
                Save without a ticket
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="badge">{spec.label}</div>
      <div className="card-title">{item.label}</div>
      <div className="field-label" style={{ marginTop: 10 }}>
        Expected: {stateLabel(expectedState)} · how did you find it?
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

export function DoorCheckItem(props: ItemProps) {
  return <StateCheckItem kind="door_check" {...props} />;
}

export function LockCheckItem(props: ItemProps) {
  return <StateCheckItem kind="lock_check" {...props} />;
}

function capitalizeFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function doneSummaryText(s: ReturnType<typeof doorCheckSummary>): string {
  // Historical rows never stored an "as found" state, so say what's actually
  // known rather than implying it was found correct.
  if (!s.foundKnown) {
    return s.final
      ? `${stateLabel(s.final)}${s.leftAsExpected ? " (matched)" : " — mismatch"}`
      : "Recorded";
  }
  if (s.foundAsExpected) return `Found ${stateLabel(s.initial!).toLowerCase()} — as expected`;
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
  const existingResult = existing?.result as
    | Extract<ItemResult, { type: "location_check" }>
    | undefined;
  const navigate = useNavigate();
  const location = useLocation();
  const current = useCurrent();

  const { data: nestedData } = db.useQuery(
    existingResult
      ? { checklists: { $: { where: { id: existingResult.nestedChecklistId } } } }
      : null,
  );
  const { data: locationData } = db.useQuery(
    !existingResult ? { locations: { $: { where: { id: cfg.locationId } } } } : null,
  );
  const nested = nestedData?.checklists?.[0];
  const locationName = locationData?.locations?.[0]?.name;
  const nestedComplete = nested?.status === "complete";

  const open = async () => {
    let nestedId = existingResult?.nestedChecklistId;
    if (!nestedId) {
      nestedId = deterministicId(`location-check:${checklistId}:${item.id}`);
      await db.transact([
        db.tx.checklists[nestedId]
          .update({
            status: "not_started",
            triggeredBy: {
              type: "location_check",
              parentChecklistId: checklistId,
              locationId: cfg.locationId,
            },
          })
          .link({ template: cfg.templateId, ...(current.user ? { assignedTo: current.user.id } : {}) }),
        db.tx.checklistItemResults[existing?.id ?? id()]
          .update({ result: { type: "location_check", nestedChecklistId: nestedId } })
          .link({ checklist: checklistId, templateItem: item.id }),
      ]);
      onSaved({ type: "location_check", nestedChecklistId: nestedId });
    }
    navigate(`/checklists/${nestedId}`, { state: { returnTo: location.pathname } });
  };

  return (
    <div className={"card" + (nestedComplete ? " card-done" : "")}>
      <div className="badge">Location-Based Check</div>
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
  checklistId,
  onSaved,
  editable = true,
}: ItemProps) {
  const cfg = (item.config ?? {}) as unknown as MeterReadingConfig;
  const existingResult = existing?.result as
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
    await saveResult(checklistId, item.id, existing?.id, result);
    setEditing(false);
    onSaved(result);
  };

  if (done) {
    return (
      <DoneCard
        badge="Meter Reading"
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
      <div className="badge">Meter Reading</div>
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
