import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import type { InstaQLEntity } from "@instantdb/react";
import { db, id, type AppSchema } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { deterministicId } from "../../lib/detId";
import { doorCheckSummary, doorStateLabel } from "../../lib/checklists";
import type {
  DoorCheckConfig,
  DoorState,
  ItemResult,
  LocationCheckConfig,
  MeterReadingConfig,
  VerifyTaskConfig,
} from "../../lib/checklists";
import type { AttachmentTarget } from "../../lib/attachments";
import { AttachmentTargetPicker } from "../shared/AttachmentTargetPicker";

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

const DOOR_STATES: DoorState[] = ["open", "unlocked", "locked"];

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

// ---------------------------------------------------------------- Door Check

/**
 * A door check records two facts, not one: the state the door was *found*
 * in, and the state it was *left* in. Only the pair supports the questions
 * the reports need to answer — "was this door actually secure overnight?"
 * and, separately, "did the guard put it right?" — which a single observed
 * state silently conflated.
 *
 * Found-as-expected is the overwhelmingly common case and stays one tap: the
 * final state is implied and the second row of buttons never appears. A
 * mismatch is the exceptional path, and it's the one worth slowing down —
 * it logs an incident (the door was wrong before anyone touched it, which is
 * true regardless of what happens next) and then asks what state the guard
 * managed to leave it in.
 */
export function DoorCheckItem({
  item,
  existing,
  checklistId,
  onSaved,
  editable = true,
}: ItemProps) {
  const cfg = (item.config ?? {}) as unknown as DoorCheckConfig;
  // An item whose config was never opened in the template builder persists
  // as `{}` — the builder only shows "Locked" as the select's default, it
  // never writes it. Default here too, matching that displayed default,
  // rather than crashing stateLabel() on an undefined state.
  const expectedState: DoorState = cfg.expectedState ?? "locked";
  const existingResult = existing?.result as
    | Extract<ItemResult, { type: "door_check" }>
    | undefined;

  const [initialState, setInitialState] = useState<DoorState | null>(null);
  const [pendingFinal, setPendingFinal] = useState<DoorState | null>(null);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [target, setTarget] = useState<AttachmentTarget | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  // Preserved across an edit so re-answering doesn't restamp the finding to
  // the time it was corrected.
  const openedAtRef = useRef<number | null>(null);
  const done = existingResult != null && !editing;

  // The door's bound Location is the incident's attachment target. Items
  // authored before that binding existed have none, so the guard picks one
  // rather than the incident silently failing to save.
  const { data: boundData } = db.useQuery(
    cfg.locationId ? { locations: { $: { where: { id: cfg.locationId } } } } : null,
  );
  const boundLocation = boundData?.locations?.[0];
  const effectiveTarget: AttachmentTarget | null = boundLocation
    ? { type: "location", id: boundLocation.id, label: boundLocation.name }
    : target;

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
      type: "door_check",
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
      // Stamped now, not at submit: a door found open at 02:10 and submitted
      // at 05:45 was open at 02:10.
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
        type: "door_check",
        expected: expectedState,
        initialState,
        finalState,
        ...(details.trim() ? { note: details.trim() } : {}),
        pendingIncident: {
          id: incidentId,
          title: title.trim() || summary,
          details: details.trim() || undefined,
          openedAt,
          ...(effectiveTarget
            ? {
                target: {
                  type: effectiveTarget.type,
                  id: effectiveTarget.id,
                  label: effectiveTarget.label,
                },
              }
            : {}),
        },
        ...(ticketId
          ? {
              pendingTicket: {
                id: ticketId,
                title: `Door left ${stateLabel(finalState).toLowerCase()}: ${item.label}`,
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
        badge="Door Check"
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
        <div className="badge">Door Check</div>
        <div className="card-title">{item.label}</div>
        <div className="badge badge-bad" style={{ margin: "8px 0", display: "block" }}>
          Found {stateLabel(initialState).toLowerCase()} — expected{" "}
          {stateLabel(expectedState).toLowerCase()}. This is logged as an incident.
        </div>

        <div className="field">
          <span className="field-label">Incident title</span>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
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
        {boundLocation ? (
          <div className="field">
            <span className="field-label">Attached to</span>
            <div className="field-value">{boundLocation.name}</div>
          </div>
        ) : (
          <div className="field">
            <span className="field-label">
              Attach to — this door has no location set in its template
            </span>
            <AttachmentTargetPicker value={target} onChange={setTarget} />
          </div>
        )}

        <div className="field-label" style={{ marginTop: 4 }}>
          What state did you leave it in?
        </div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {DOOR_STATES.map((s) => (
            <button
              key={s}
              type="button"
              className={
                "btn btn-sm" + (pendingFinal === s ? " btn-primary" : "")
              }
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
      <div className="badge">Door Check</div>
      <div className="card-title">{item.label}</div>
      <div className="field-label" style={{ marginTop: 10 }}>
        Expected: {stateLabel(expectedState)} · how did you find it?
      </div>
      <div className="row" style={{ flexWrap: "wrap", marginTop: 8 }}>
        {DOOR_STATES.map((s) => (
          <button key={s} type="button" className="btn btn-sm" onClick={() => void selectInitial(s)}>
            {stateLabel(s)}
          </button>
        ))}
      </div>
    </div>
  );
}

function doneSummaryText(s: ReturnType<typeof doorCheckSummary>): string {
  // Historical rows never stored an "as found" state, so say what's actually
  // known rather than implying the door was found correct.
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
