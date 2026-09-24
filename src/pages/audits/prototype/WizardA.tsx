// PROTOTYPE — throwaway. Variant A: the queue. One item on the screen at a
// time; Next walks items, then rolls into the next location by itself. The
// auditor never chooses what to look at - they look at what is shown.
import { useState } from "react";
import { ItemControl } from "./ItemControl";
import { JumpBody } from "./JumpBody";
import { answeredCount, isAnswered, stepOfTarget, type RunProps } from "./wizardModel";

export const name = "Queue";

export function WizardA(p: RunProps) {
  const [jump, setJump] = useState(false);
  const step = p.steps[p.index];
  if (!step) return null;
  const items = p.itemsFor(step.target);
  const answers = p.answers[step.target.id];
  const onFile = p.onFile(step.target, step.item);
  const last = p.index === p.steps.length - 1;
  const locationsLeft = p.targets.length - step.targetIndex;

  return (
    <div className="wz-layer">
      <div className="wz-topbar">
        <button type="button" className="btn btn-sm btn-bare" onClick={p.onExit}>
          ✕ Exit
        </button>
        <span className="muted small">
          {step.targetIndex + 1} of {p.targets.length} locations · {locationsLeft - 1} to go
        </span>
        <button type="button" className="btn btn-sm" data-testid="wz-jump" onClick={() => setJump(true)}>
          Jump to…
        </button>
      </div>

      <div className="wz-body">
        <div className="wz-a-stage">
          <div>
            <div className="wz-a-location" data-testid="wz-location">{step.target.location_name}</div>
            <div className="muted small">{step.target.type_name}</div>
          </div>
          <div className="wz-pips" aria-label={`item ${step.itemIndex + 1} of ${items.length}`}>
            {items.map((it, i) => (
              <span key={it.key} className={`wz-pip ${i === step.itemIndex ? "now" : isAnswered(answers?.[it.key], it.kind) ? "done" : ""}`} />
            ))}
          </div>
          <div>
            <div className="muted small">{step.item.group}</div>
            <div className="wz-a-item" data-testid="wz-item">{step.item.label}</div>
          </div>
          <ItemControl
            item={step.item}
            value={answers?.[step.item.key]}
            statuses={p.statuses}
            big
            onChange={(v) => p.setAnswer(step.target.id, step.item.key, v)}
          />
          {onFile && <div className="wz-a-prefill">On file: {onFile}</div>}
          <div className="muted small">{p.savedNote}</div>
        </div>
      </div>

      <div className="wz-footer">
        <button type="button" className="btn" disabled={p.index === 0} onClick={() => p.setIndex(p.index - 1)}>
          ◀ Back
        </button>
        <button
          type="button"
          className="btn btn-primary wz-grow"
          data-testid="wz-next"
          onClick={() => (last ? p.onExit() : p.setIndex(p.index + 1))}
        >
          {last ? "Finish" : `Next · ${answeredCount(items, answers)} of ${items.length} here`}
        </button>
      </div>

      {jump && (
        <div className="wz-sheet-backdrop" onClick={() => setJump(false)}>
          <div className="wz-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="wz-sheet-head">
              <b>Jump to a location</b>
            </div>
            <JumpBody
              {...p}
              currentTargetId={step.target.id}
              onPick={(x) => {
                p.setIndex(stepOfTarget(p.steps, x.id));
                setJump(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
