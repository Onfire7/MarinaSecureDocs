// PROTOTYPE — throwaway. Variant C: two axes, both visible. The items of
// this location are a strip of chips across the top (tap any one); the
// locations are a pager across the bottom. One item fills the middle. The
// bet is that seeing both axes beats a single queue when you are skipping
// around a dock rather than walking it in order.
import { useState } from "react";
import { ItemControl } from "./ItemControl";
import { JumpBody } from "./JumpBody";
import { answeredCount, isAnswered, stepOfTarget, type RunProps } from "./wizardModel";

export const name = "Two axes";

export function WizardC(p: RunProps) {
  const [jump, setJump] = useState(false);
  const step = p.steps[p.index];
  if (!step) return null;
  const t = step.target;
  const items = p.itemsFor(t);
  const answers = p.answers[t.id];
  const firstOf = (targetIndex: number) => p.steps.findIndex((s) => s.targetIndex === targetIndex);
  const prev = firstOf(step.targetIndex - 1);
  const next = firstOf(step.targetIndex + 1);
  const onFile = p.onFile(t, step.item);
  const left = p.targets.filter((x) => !p.answeredTarget(x.id)).length;

  return (
    <div className="wz-layer">
      <div className="wz-topbar">
        <button type="button" className="btn btn-sm btn-bare" onClick={p.onExit}>
          ✕ Exit
        </button>
        <span className="muted small">{p.auditName}</span>
        <span className="badge badge-accent">{left} left</span>
      </div>

      <div className="wz-c-strip" role="tablist">
        {items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            role="tab"
            aria-selected={i === step.itemIndex}
            className={`wz-c-chip ${i === step.itemIndex ? "now" : isAnswered(answers?.[it.key], it.kind) ? "done" : ""}`}
            data-testid="wz-item-chip"
            onClick={() => p.setIndex(firstOf(step.targetIndex) + i)}
          >
            {it.label.length > 22 ? it.label.slice(0, 21) + "…" : it.label}
          </button>
        ))}
      </div>

      <div className="wz-body">
        <div className="wz-c-stage">
          <div>
            <div className="muted small">{step.item.group}</div>
            <div className="wz-a-item" data-testid="wz-item">{step.item.label}</div>
          </div>
          <ItemControl item={step.item} value={answers?.[step.item.key]} statuses={p.statuses} big onChange={(v) => p.setAnswer(t.id, step.item.key, v)} />
          {onFile && <div className="wz-a-prefill">On file: {onFile}</div>}
          <div className="muted small">
            {answeredCount(items, answers)} of {items.length} answered here · {p.savedNote}
          </div>
        </div>
      </div>

      <div className="wz-footer">
        <div className="wz-c-pager">
          <button type="button" className="btn" disabled={prev === -1} onClick={() => p.setIndex(prev)}>
            ◀
          </button>
          <button type="button" className="wz-c-now" data-testid="wz-jump" onClick={() => setJump(true)}>
            <span data-testid="wz-location">{t.location_name}</span>
            <div className="muted small">
              {step.targetIndex + 1} of {p.targets.length} · tap to jump
            </div>
          </button>
          <button type="button" className="btn btn-primary" data-testid="wz-next" disabled={next === -1} onClick={() => p.setIndex(next)}>
            ▶
          </button>
        </div>
      </div>

      {jump && (
        <div className="wz-sheet-backdrop" onClick={() => setJump(false)}>
          <div className="wz-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="wz-sheet-head">
              <b>Jump to a location</b>
            </div>
            <JumpBody
              {...p}
              currentTargetId={t.id}
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
