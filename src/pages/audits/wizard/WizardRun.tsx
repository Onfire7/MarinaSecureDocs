// The wizard's run screen (AuditWizardPage.spec.md; docs/audits.md § The
// wizard). Settled by prototype on 2026-09-23 - branch
// prototype/audit-wizard, four variants; this is D, the owner's own.
//
// On a phone, two axes of *scroll*:
//   · every item of a location is its own screen-sized page, stacked
//     vertically - swipe or turn the wheel to move through them; a
//     deliberate move tweens there over 500ms, free scrolling snaps;
//   · locations sit side by side, and moving between them slides
//     horizontally over 500ms, however far apart they are;
//   · scrolling past the last item rolls into the next location, and past
//     the first rolls back into the previous one, landing on its last item;
//   · the pips are a rail down the left edge, capped with the arrows that
//     say the page scrolls;
//   · answering moves to the next logical field - a Service answered
//     Present focuses its note so it can be typed or skipped with Next;
//   · the bottom bar is tinted green from the left with the run's progress.
//
// On a desktop the whole location is one page and the right-hand sidebar is
// the jump list with the pager at its foot: there is no reason to scroll a
// screen at a time on a machine that can show the lot.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { ConfirmPage } from "./ConfirmPage";
import { ItemControl } from "./ItemControl";
import { JumpBody } from "./JumpBody";
import { useVisiblePageHeight } from "./useVisiblePageHeight";
import { isAnswered, stepOfTarget, type Step, type WizardTarget } from "../../../lib/auditWizard";
import type { RunProps } from "./runProps";

const SLIDE_MS = 500;
/** Pages give way to the keyboard over this long; see wizard.css. */
const RESIZE_MS = 250;
/** How much overscroll at an edge rolls into the next location. */
const EDGE = 120;

export function WizardRun(p: RunProps) {
  const wide = useWide();
  const [jump, setJump] = useState(false);
  const [slide, setSlide] = useState<{ from: number; dir: 1 | -1 } | null>(null);
  const colRef = useRef<HTMLDivElement | null>(null);
  const fromScroll = useRef(false);
  const justSlid = useRef(false);
  const overscroll = useRef(0);
  const cooling = useRef(false);
  /** A tween writes scrollTop every frame, and every frame is a scroll
   *  event. Letting those move the index means the tween chases a target
   *  that is being rewritten under it, and it lands a page early. */
  const tweening = useRef(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** How tall a page is: the whole scroller, less whatever the keyboard
   *  covers. Null until first measured, when it is simply 100%. */
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  const touchY = useRef<number | null>(null);
  const step = p.steps[p.index];
  const firstOf = (ti: number) => p.steps.findIndex((s) => s.targetIndex === ti);
  const lastOf = (ti: number) => {
    const first = firstOf(ti);
    if (first === -1) return -1;
    let i = first;
    while (p.steps[i + 1]?.targetIndex === ti) i += 1;
    return i;
  };

  // Land on the current item. A slide has already put the new column where
  // it belongs, and the auditor's own scrolling needs no help.
  //
  // The dependency is the INDEX, never `step`. `step` is rebuilt whenever
  // buildSteps() runs, which is whenever any of the queries behind the
  // catalogue re-emits - and a PowerSync query re-emits every time anything
  // it touches changes, which includes the answer just written. Depending on
  // its identity ran this effect mid-swipe with the index unchanged, and
  // since the scroller was then between two pages, it tweened back to the
  // one being left: the scroll fought the thumb, several times per swipe.
  useEffect(() => {
    const el = colRef.current;
    if (!el || !step || wide) return;
    if (justSlid.current) {
      justSlid.current = false;
      focusActive(el, step.itemIndex);
      return;
    }
    if (fromScroll.current) {
      fromScroll.current = false;
      focusActive(el, step.itemIndex);
      return;
    }
    const to = pageTop(el, step.itemIndex);
    if (to === null || Math.abs(el.scrollTop - to) < 4) {
      focusActive(el, step.itemIndex);
      return;
    }
    tweening.current = true;
    tween(el, to, SLIDE_MS, () => {
      tweening.current = false;
      focusActive(el, step.itemIndex);
    });
    // `step` and the refs are read at run time and deliberately not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.index, wide]);

  // A keyboard opening does not resize the viewport here - the pager is
  // meant to go under it - so the pages give way instead, and the question
  // stays centred in what is left.
  useVisiblePageHeight(wrapRef, useCallback((px: number) => setPageHeight((was) => (was === px ? was : px)), []));

  // Nothing outside the run scrolls while it is open. A document that can
  // scroll is a document the browser will scroll when the keyboard opens,
  // and the first swipe afterwards goes into putting it back.
  useEffect(() => {
    const root = document.documentElement;
    const was = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = was;
    };
  }, []);

  // While the pages animate to their new height, every page moves. Hold the
  // one being answered against the top of the scroller for the length of it,
  // with snapping out of the way as ever.
  const itemIndexRef = useRef(0);
  itemIndexRef.current = step?.itemIndex ?? 0;
  useEffect(() => {
    const el = colRef.current;
    if (el === null || pageHeight === null) return;
    el.style.scrollSnapType = "none";
    const start = performance.now();
    let frame = 0;
    const pin = (now: number) => {
      const to = pageTop(el, itemIndexRef.current);
      if (to !== null) el.scrollTop = to;
      if (now - start < RESIZE_MS + 40) frame = requestAnimationFrame(pin);
      else el.style.scrollSnapType = "";
    };
    frame = requestAnimationFrame(pin);
    return () => {
      cancelAnimationFrame(frame);
      el.style.scrollSnapType = "";
    };
  }, [pageHeight]);

  if (!step) return null;
  const t = step.target;
  const items = p.itemsFor(t);
  const answers = p.answers[t.id];
  const prev = firstOf(step.targetIndex - 1);
  const next = firstOf(step.targetIndex + 1);
  const done = p.steps.filter((s) => p.touched(s.target.id, s.item.key)).length;
  const pct = p.steps.length ? Math.round((done / p.steps.length) * 100) : 0;

  const goLocation = (targetIndex: number, land: "first" | "last" = "first") => {
    const at = land === "last" ? lastOf(targetIndex) : firstOf(targetIndex);
    if (at === -1 || targetIndex === step.targetIndex) return;
    justSlid.current = true;
    setSlide({ from: step.targetIndex, dir: targetIndex > step.targetIndex ? 1 : -1 });
    p.setIndex(at);
    window.setTimeout(() => setSlide(null), SLIDE_MS);
  };
  const goItem = (itemIndex: number) => {
    if (itemIndex < 0) {
      goLocation(step.targetIndex - 1, "last");
      return;
    }
    if (itemIndex >= items.length) {
      goLocation(step.targetIndex + 1);
      return;
    }
    p.setIndex(firstOf(step.targetIndex) + itemIndex);
  };

  /** Is this gesture the confirmation page's review list's business? The
   *  run sits at the bottom of its stack whenever that page is showing, so
   *  without this every swipe over the review counted as overscroll and
   *  rolled into the next location - the review itself never moved. Once
   *  the list is at its end the gesture is the run's again. */
  const innerScroller = (target: EventTarget | null, dy: number) => {
    const el = target instanceof Element ? target.closest<HTMLElement>(".wz-c-review-list") : null;
    if (!el || el.scrollHeight <= el.clientHeight) return false;
    return dy > 0 ? el.scrollTop < el.scrollHeight - el.clientHeight - 1 : el.scrollTop > 1;
  };

  /** Pushing past either end of the stack rolls into the neighbouring
   *  location - the ribbon has no walls, only corners. */
  const edgeNudge = (dy: number, target: EventTarget | null = null) => {
    const el = colRef.current;
    if (!el || cooling.current) return;
    if (innerScroller(target, dy)) {
      overscroll.current = 0;
      return;
    }
    const atTop = el.scrollTop <= 2;
    const atBottom = el.scrollTop >= el.scrollHeight - el.clientHeight - 2;
    if ((dy < 0 && atTop) || (dy > 0 && atBottom)) {
      overscroll.current += dy;
      if (Math.abs(overscroll.current) >= EDGE) {
        const forward = overscroll.current > 0;
        overscroll.current = 0;
        cooling.current = true;
        window.setTimeout(() => (cooling.current = false), SLIDE_MS + 200);
        if (forward) goLocation(step.targetIndex + 1);
        else goLocation(step.targetIndex - 1, "last");
      }
    } else {
      overscroll.current = 0;
    }
  };
  const pager = (
    <div className="wz-c-pager">
      <button type="button" className="btn" disabled={prev === -1} onClick={() => goLocation(step.targetIndex - 1)}>
        ◀
      </button>
      <button type="button" className="wz-c-now" data-testid="wz-jump" onClick={() => !wide && setJump(true)}>
        <span data-testid="wz-location">{t.location_name}</span>
        <div className="muted small">
          {step.targetIndex + 1} of {p.targets.length}
          {wide ? "" : " · tap to jump"}
        </div>
      </button>
      <button type="button" className="btn btn-primary" data-testid="wz-next" disabled={next === -1} onClick={() => goLocation(step.targetIndex + 1)}>
        ▶
      </button>
    </div>
  );

  return (
    <div className="wz-layer">
      <div className="wz-topbar">
        <button type="button" className="btn btn-sm btn-bare" onClick={p.onExit}>
          ✕ Exit
        </button>
        <span className="muted small">{p.auditName}</span>
        <span className="badge badge-accent" data-testid="wz-pct">{pct}%</span>
      </div>

      {wide ? (
        <div className="wz-d-desk">
          <div className={`wz-d-main ${slide ? (slide.dir === 1 ? "wz-in-right" : "wz-in-left") : ""}`} key={step.targetIndex}>
            <LocationPage
              t={t}
              p={p}
              items={items}
              answers={answers}
              onAdvance={() => goItem(step.itemIndex + 1)}
              onConfirmed={() => goLocation(step.targetIndex + 1)}
            />
          </div>
          <aside className="wz-d-side">
            <div className="wz-d-side-list">
              <JumpBody {...p} currentTargetId={t.id} onPick={(x) => goLocation(p.steps[stepOfTarget(p.steps, x.id)].targetIndex)} />
            </div>
            <div className="wz-d-side-nav" style={{ background: `linear-gradient(90deg, var(--good-bg) ${pct}%, transparent ${pct}%)` }} data-testid="wz-progress-bar">
              {pager}
            </div>
          </aside>
        </div>
      ) : (
        <>
          <div
            className="wz-d-wrap"
            ref={wrapRef}
            style={pageHeight === null ? undefined : ({ "--wz-page-h": `${pageHeight}px` } as CSSProperties)}
            onWheel={(e) => edgeNudge(e.deltaY, e.target)}
            onTouchStart={(e) => (touchY.current = e.touches[0]?.clientY ?? null)}
            onTouchMove={(e) => {
              const y = e.touches[0]?.clientY ?? null;
              if (touchY.current !== null && y !== null) edgeNudge(touchY.current - y, e.target);
              touchY.current = y;
            }}
            onTouchEnd={() => {
              touchY.current = null;
              overscroll.current = 0;
            }}
          >
            <div className="wz-d-rail">
              <button type="button" className="wz-d-arrow" data-testid="wz-up" aria-label="previous item" onClick={() => goItem(step.itemIndex - 1)}>
                ▲
              </button>
              <div className="wz-d-pips">
                {items.map((it, i) => (
                  <button
                    key={it.key}
                    type="button"
                    title={it.label}
                    aria-label={it.label}
                    data-testid="wz-pip"
                    className={`wz-d-pip ${i === step.itemIndex ? "now" : p.touched(t.id, it.key) ? "done" : isAnswered(answers?.[it.key], it.kind) ? "onfile" : ""}`}
                    onClick={() => goItem(i)}
                  />
                ))}
              </div>
              <button type="button" className="wz-d-arrow" data-testid="wz-down" aria-label="next item" onClick={() => goItem(step.itemIndex + 1)}>
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
              startAt={justSlid.current ? step.itemIndex : undefined}
              scrollRef={colRef}
              onScrollItem={(i) => {
                if (tweening.current || i === step.itemIndex) return;
                fromScroll.current = true;
                p.setIndex(firstOf(step.targetIndex) + i);
              }}
              onAdvance={() => goItem(step.itemIndex + 1)}
              onConfirmed={() => goLocation(step.targetIndex + 1)}
            />
          </div>

          <div
            className="wz-footer wz-d-footer"
            style={{ background: `linear-gradient(90deg, var(--good-bg) ${pct}%, var(--panel) ${pct}%)` }}
            data-testid="wz-progress-bar"
          >
            {pager}
          </div>
        </>
      )}

      {jump && !wide && (
        <div className="wz-sheet-backdrop" onClick={() => setJump(false)}>
          <div className="wz-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="wz-sheet-head">
              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <b>Jump to a location</b>
                <button type="button" className="btn btn-sm btn-bare" style={{ marginLeft: "auto" }} onClick={() => setJump(false)}>
                  ✕
                </button>
              </div>
            </div>
            <JumpBody
              {...p}
              currentTargetId={t.id}
              onPick={(x) => {
                goLocation(p.steps[stepOfTarget(p.steps, x.id)].targetIndex);
                setJump(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** The desktop pane: one location, every selected item at once. */
function LocationPage({
  t,
  p,
  items,
  answers,
  onAdvance,
  onConfirmed,
}: {
  t: WizardTarget;
  p: RunProps;
  items: ReturnType<RunProps["itemsFor"]>;
  answers: RunProps["answers"][string] | undefined;
  onAdvance: () => void;
  onConfirmed: () => void;
}) {
  let group = "";
  return (
    <div className="wz-d-page-wide">
      <div className="wz-b-head">
        <h2 data-testid="wz-location-wide">{t.location_name}</h2>
        <span className="muted small">{t.type_name}</span>
      </div>
      {items.map((item) => {
        const head = item.group !== group ? item.group : null;
        group = item.group;
        const value = answers?.[item.key];
        const onFile = p.onFile(t, item);
        if (item.kind === "confirm")
          return (
            <div key={item.key}>
              <div className="wz-b-group">{item.label}</div>
              <ConfirmPage t={t} p={p} onDone={onConfirmed} />
            </div>
          );
        return (
          <div key={item.key}>
            {head && <div className="wz-b-group">{head}</div>}
            <div className={`wz-b-row ${p.touched(t.id, item.key) ? "done" : ""}`}>
              <div className="wz-b-row-label">
                {item.label}
                {onFile && <span className="muted small" style={{ fontWeight: 400 }}> · on file: {onFile}</span>}
              </div>
              <ItemControl item={item} value={value} statuses={p.statuses} advance={onAdvance} onChange={(v, mode) => p.setAnswer(t.id, item.key, v, mode)} />
            </div>
          </div>
        );
      })}
      <p className="muted small">{p.savedNote}</p>
    </div>
  );
}

/** One location on a phone: its items stacked as full-height, snapping pages. */
function Column({
  className,
  steps,
  targetIndex,
  p,
  activeIndex,
  startAt,
  scrollRef,
  onScrollItem,
  onAdvance,
  onConfirmed,
}: {
  className: string;
  steps: Step[];
  targetIndex: number;
  p: RunProps;
  activeIndex?: number;
  /** Arriving backwards lands on the last item, without animating there. */
  startAt?: number;
  scrollRef?: React.MutableRefObject<HTMLDivElement | null>;
  onScrollItem?: (i: number) => void;
  onAdvance?: () => void;
  /** Confirming a location is the end of it: the run moves on. */
  onConfirmed?: () => void;
}) {
  const own = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = own.current;
    const to = el && startAt ? pageTop(el, startAt) : null;
    if (el && to !== null) el.scrollTop = to;
    // Only on mount: later moves are the parent's business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const target = steps.find((s) => s.targetIndex === targetIndex)?.target;
  if (!target) return null;
  const items = p.itemsFor(target);
  const answers = p.answers[target.id];
  return (
    <div
      className={className}
      ref={(el) => {
        own.current = el;
        if (scrollRef) scrollRef.current = el;
      }}
      onScroll={(e) => {
        const el = e.currentTarget;
        if (!onScrollItem || el.clientHeight === 0) return;
        onScrollItem(nearestPage(el));
      }}
    >
      {items.map((item, i) => {
        const onFile = p.onFile(target, item);
        return (
          <section className={`wz-d-page ${item.kind === "confirm" ? "wz-d-confirm" : ""}`} key={item.key} data-page={i}>
            <div className="wz-d-heading">
              <h1 className="wz-d-loc">{target.location_name}</h1>
              {target.type_name && <div className="wz-d-type">{target.type_name}</div>}
              <div className="wz-d-rule" aria-hidden />
              <div className="wz-d-group">{item.group}</div>
              <div className="wz-d-label">{item.label}</div>
            </div>
            {item.kind === "confirm" ? (
              <ConfirmPage t={target} p={p} onDone={onConfirmed} />
            ) : (
              <>
                <ItemControl
                  item={item}
                  value={answers?.[item.key]}
                  statuses={p.statuses}
                  big
                  autoFocus={i === activeIndex}
                  advance={onAdvance}
                  onChange={(v, mode) => p.setAnswer(target.id, item.key, v, mode)}
                />
                {onFile && <div className="wz-a-prefill">On file: {onFile}</div>}
              </>
            )}
            <div className="muted small">
              {i + 1} of {items.length} here · {p.savedNote}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function useWide(px = 900) {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(`(min-width:${px}px)`).matches);
  useEffect(() => {
    const m = window.matchMedia(`(min-width:${px}px)`);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [px]);
  return wide;
}

/** Where a page actually starts. NOT index × clientHeight: a page is
 *  `height: 100%` of a container whose own height is fractional, so the two
 *  drift by a pixel or so per page - and a tween that stops a pixel short of
 *  a snap point is snapped backwards, landing a whole page early. */
function pageTop(el: HTMLElement, index: number): number | null {
  const page = el.querySelector<HTMLElement>(`[data-page="${index}"]`);
  return page ? page.offsetTop : null;
}

/** The page the container is closest to showing. */
function nearestPage(el: HTMLElement): number {
  const pages = [...el.querySelectorAll<HTMLElement>("[data-page]")];
  let best = 0;
  let bestGap = Infinity;
  pages.forEach((page, i) => {
    const gap = Math.abs(page.offsetTop - el.scrollTop);
    if (gap < bestGap) {
      bestGap = gap;
      best = i;
    }
  });
  return best;
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

/**
 * The field on the page just landed on takes focus, so a number is typed
 * without reaching for the screen - and where a page has no field, the
 * keyboard is dismissed rather than left standing over a page of buttons
 * because the page before it had a note.
 *
 * Focus already inside this page is left exactly where it is. This runs
 * again on every re-render, and a write causes one: without the guard,
 * pressing Next to move from a number to its note was undone a moment
 * later by the page taking focus back to the number.
 *
 * Focus belonging to a page the run has LEFT is dropped, which is what
 * dismisses the keyboard.
 */
function focusActive(el: HTMLElement, index: number) {
  const page = el.querySelector<HTMLElement>(`[data-page="${index}"]`);
  const active = document.activeElement;
  const here = active instanceof HTMLElement && el.contains(active);
  if (here && page?.contains(active)) return;
  const field = page?.querySelector<HTMLInputElement>("[data-autofocus]");
  if (field) {
    field.focus();
    return;
  }
  if (here) (active as HTMLElement).blur();
}
