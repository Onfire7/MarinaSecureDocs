// PROTOTYPE — throwaway. Variant D: the filmstrip, as the owner described
// it on 2026-09-23. Two axes of *scroll* rather than two sets of buttons:
//
//   · every item of a location is its own screen-sized page, stacked
//     vertically - swipe up and down, or turn the wheel, to move through
//     them; a deliberate move (a tapped answer, an arrow, Enter) tweens
//     there over 500ms, and free scrolling snaps;
//   · locations sit side by side - moving to one slides horizontally over
//     500ms, however far away it is;
//   · the pips are a thin rail down the left edge, capped with the arrows
//     that say the page scrolls;
//   · answering a choice moves on by itself, fields take focus on arrival,
//     and a number field's Next key advances;
//   · the bottom bar is C's pager and jump sheet, tinted green from the
//     left with how much of the run is done.
import { useEffect, useRef, useState } from "react";
import { ItemControl } from "./ItemControl";
import { JumpSheet } from "./JumpSheet";
import { isAnswered, stepOfTarget, type RunProps, type Step } from "./wizardModel";

export const name = "Filmstrip";

const SLIDE_MS = 500;

export function WizardD(p: RunProps) {
  const [jump, setJump] = useState(false);
  const [slide, setSlide] = useState<{ from: number; dir: 1 | -1 } | null>(null);
  const colRef = useRef<HTMLDivElement | null>(null);
  const fromScroll = useRef(false);
  const step = p.steps[p.index];
  const firstOf = (ti: number) => p.steps.findIndex((s) => s.targetIndex === ti);

  // Land on the current item: tween unless the auditor's own scrolling is
  // what moved us, in which case the browser's snap has already done it.
  useEffect(() => {
    const el = colRef.current;
    if (!el || !step) return;
    if (fromScroll.current) {
      fromScroll.current = false;
      focusActive(el, step.itemIndex);
      return;
    }
    const to = step.itemIndex * el.clientHeight;
    if (Math.abs(el.scrollTop - to) < 4) {
      focusActive(el, step.itemIndex);
      return;
    }
    tween(el, to, SLIDE_MS, () => focusActive(el, step.itemIndex));
  }, [p.index, step]);

  if (!step) return null;
  const t = step.target;
  const items = p.itemsFor(t);
  const answers = p.answers[t.id];
  const prev = firstOf(step.targetIndex - 1);
  const next = firstOf(step.targetIndex + 1);
  const done = p.steps.filter((s) => p.touched(s.target.id, s.item.key)).length;
  const pct = p.steps.length ? Math.round((done / p.steps.length) * 100) : 0;

  const goLocation = (targetIndex: number) => {
    const at = firstOf(targetIndex);
    if (at === -1 || targetIndex === step.targetIndex) return;
    setSlide({ from: step.targetIndex, dir: targetIndex > step.targetIndex ? 1 : -1 });
    p.setIndex(at);
    window.setTimeout(() => setSlide(null), SLIDE_MS);
  };
  const goItem = (itemIndex: number) => {
    if (itemIndex < 0) {
      if (prev !== -1) goLocation(step.targetIndex - 1);
      return;
    }
    if (itemIndex >= items.length) {
      // The end of a location's stack rolls into the next one.
      if (next !== -1) goLocation(step.targetIndex + 1);
      return;
    }
    p.setIndex(firstOf(step.targetIndex) + itemIndex);
  };

  // A horizontal drag moves locations; vertical is the scroller's own.
  const drag = useRef<{ x: number; y: number } | null>(null);

  return (
    <div className="wz-layer">
      <div className="wz-topbar">
        <button type="button" className="btn btn-sm btn-bare" onClick={p.onExit}>
          ✕ Exit
        </button>
        <span className="muted small">{p.auditName}</span>
        <span className="badge badge-accent">{pct}%</span>
      </div>

      <div
        className="wz-d-wrap"
        onPointerDown={(e) => (drag.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - d.y)) {
            goLocation(step.targetIndex + (dx < 0 ? 1 : -1));
          }
        }}
      >
        <div className="wz-d-rail" aria-hidden>
          <button type="button" className="wz-d-arrow" data-testid="wz-up" onClick={() => goItem(step.itemIndex - 1)}>
            ▲
          </button>
          <div className="wz-d-pips">
            {items.map((it, i) => (
              <button
                key={it.key}
                type="button"
                title={it.label}
                data-testid="wz-pip"
                className={`wz-d-pip ${i === step.itemIndex ? "now" : p.touched(t.id, it.key) ? "done" : isAnswered(answers?.[it.key], it.kind) ? "onfile" : ""}`}
                onClick={() => goItem(i)}
              />
            ))}
          </div>
          <button type="button" className="wz-d-arrow" data-testid="wz-down" onClick={() => goItem(step.itemIndex + 1)}>
            ▼
          </button>
        </div>

        {slide && (
          <Column
            key={`out-${slide.from}`}
            className={`wz-d-col ${slide.dir === 1 ? "wz-out-left" : "wz-out-right"}`}
            steps={p.steps}
            targetIndex={slide.from}
            p={p}
          />
        )}
        <Column
          key={step.targetIndex}
          className={`wz-d-col ${slide ? (slide.dir === 1 ? "wz-in-right" : "wz-in-left") : ""}`}
          steps={p.steps}
          targetIndex={step.targetIndex}
          p={p}
          activeIndex={step.itemIndex}
          scrollRef={colRef}
          onScrollItem={(i) => {
            if (i === step.itemIndex) return;
            fromScroll.current = true;
            p.setIndex(firstOf(step.targetIndex) + i);
          }}
          onAdvance={() => goItem(step.itemIndex + 1)}
        />
      </div>

      <div
        className="wz-footer wz-d-footer"
        style={{ background: `linear-gradient(90deg, var(--good-bg) ${pct}%, var(--panel) ${pct}%)` }}
        data-testid="wz-progress-bar"
      >
        <div className="wz-c-pager">
          <button type="button" className="btn" disabled={prev === -1} onClick={() => goLocation(step.targetIndex - 1)}>
            ◀
          </button>
          <button type="button" className="wz-c-now" data-testid="wz-jump" onClick={() => setJump(true)}>
            <span data-testid="wz-location">{t.location_name}</span>
            <div className="muted small">
              {step.targetIndex + 1} of {p.targets.length} · tap to jump
            </div>
          </button>
          <button type="button" className="btn btn-primary" data-testid="wz-next" disabled={next === -1} onClick={() => goLocation(step.targetIndex + 1)}>
            ▶
          </button>
        </div>
      </div>

      {jump && (
        <JumpSheet
          {...p}
          currentTargetId={t.id}
          onPick={(x) => {
            const at = stepOfTarget(p.steps, x.id);
            goLocation(p.steps[at].targetIndex);
            setJump(false);
          }}
          onClose={() => setJump(false)}
        />
      )}
    </div>
  );
}

/** One location: its items stacked as full-height, snapping pages. */
function Column({
  className,
  steps,
  targetIndex,
  p,
  activeIndex,
  scrollRef,
  onScrollItem,
  onAdvance,
}: {
  className: string;
  steps: Step[];
  targetIndex: number;
  p: RunProps;
  activeIndex?: number;
  scrollRef?: React.MutableRefObject<HTMLDivElement | null>;
  onScrollItem?: (i: number) => void;
  onAdvance?: () => void;
}) {
  const target = steps.find((s) => s.targetIndex === targetIndex)?.target;
  if (!target) return null;
  const items = p.itemsFor(target);
  const answers = p.answers[target.id];
  return (
    <div
      className={className}
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (!onScrollItem || el.clientHeight === 0) return;
        onScrollItem(Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / el.clientHeight))));
      }}
    >
      {items.map((item, i) => {
        const onFile = p.onFile(target, item);
        return (
          <section className="wz-d-page" key={item.key} data-page={i}>
            <div className="wz-d-where">
              <b>{target.location_name}</b>
              <span className="muted small"> · {target.type_name}</span>
            </div>
            <div>
              <div className="muted small">{item.group}</div>
              <div className="wz-d-label">{item.label}</div>
            </div>
            <ItemControl
              item={item}
              value={answers?.[item.key]}
              statuses={p.statuses}
              big
              autoFocus={i === activeIndex}
              advance={onAdvance}
              onChange={(v) => p.setAnswer(target.id, item.key, v)}
            />
            {onFile && <div className="wz-a-prefill">On file: {onFile}</div>}
            <div className="muted small">
              {i + 1} of {items.length} here · {p.savedNote}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** A fixed-duration scroll, because the browser's own smooth scrolling has
 *  no duration we can set - and with mandatory snapping on, every frame we
 *  write is snapped back to the nearest page, so the tween arrives as a
 *  jump. Snapping is suspended for the length of it. */
function tween(el: HTMLElement, to: number, ms: number, done: () => void) {
  const from = el.scrollTop;
  if (Math.abs(to - from) < 1) {
    done();
    return;
  }
  el.style.scrollSnapType = "none";
  const finish = () => {
    el.style.scrollSnapType = "";
    done();
  };
  const start = performance.now();
  const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  const frame = (now: number) => {
    const k = Math.min(1, (now - start) / ms);
    el.scrollTop = from + (to - from) * ease(k);
    if (k < 1) requestAnimationFrame(frame);
    else finish();
  };
  requestAnimationFrame(frame);
}

/** The field on the page just landed on takes focus, so a number is typed
 *  without reaching for the screen. */
function focusActive(el: HTMLElement, index: number) {
  const page = el.querySelector<HTMLElement>(`[data-page="${index}"]`);
  page?.querySelector<HTMLInputElement>("[data-autofocus]")?.focus();
}
