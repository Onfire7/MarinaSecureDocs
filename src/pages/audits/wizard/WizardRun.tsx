// The wizard's run screen (AuditWizardPage.spec.md; docs/audits.md § The
// wizard). Settled by prototype on 2026-09-23 - branch
// prototype/audit-wizard, four variants; this is D, the owner's own.
//
// On a phone, two axes of *scroll*:
//   · every item of a location is its own screen-sized page, stacked
//     vertically. The column does not scroll natively: the run owns the
//     touch stream, carries the page with the thumb at 5x, stops it dead
//     at the next page, and tweens the rest of the way on release. A
//     wheel burst is one page. A deliberate move tweens over 500ms;
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
import { answeredCount, pagesForTarget, stepOfTarget, type Step, type WizardItem, type WizardPage, type WizardTarget } from "../../../lib/auditWizard";
import type { RunProps } from "./runProps";

const SLIDE_MS = 500;
/** Pages give way to the keyboard over this long; see wizard.css. */
const RESIZE_MS = 250;
/** A page moves this many pixels per pixel of thumb. A fifth of a screen
 *  of thumb carries a whole page, and the page stops there whatever the
 *  thumb does next. */
const GAIN = 5;
/** On release the page nearest the thumb wins: past half way it turns,
 *  short of that it goes back. At GAIN that is ~75px of thumb. */
const TURN_AT = 0.5;
/** Thumb pixels pushed against the end of the column, beyond where the
 *  page stopped, that roll into the next location. */
const EDGE = 60;
/** Wheel delta that turns one page. */
const WHEEL_STEP = 40;

export function WizardRun(p: RunProps) {
  const wide = useWide();
  const [jump, setJump] = useState(false);
  const [slide, setSlide] = useState<{ from: number; dir: 1 | -1 } | null>(null);
  const colRef = useRef<HTMLDivElement | null>(null);
  const fromScroll = useRef(false);
  const justSlid = useRef(false);
  const cooling = useRef(false);
  const wheelAcc = useRef(0);
  /** The tween in flight, if any; a touch cancels it. */
  const tweenStop = useRef<(() => void) | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /** How tall a page is: the whole scroller, less whatever the keyboard
   *  covers. Null until first measured, when it is simply 100%. */
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  /** The drag in progress. `inner` means the gesture belongs to the
   *  confirmation page's review list and the run leaves it alone. `spent`
   *  means it already rolled into another location. */
  const drag = useRef<
    { y0: number; top0: number; page: number; lo: number; hi: number; spent: boolean } | { inner: true; y0: number; decided: boolean } | null
  >(null);
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
      focusActive(el, step.pageIndex);
      return;
    }
    if (fromScroll.current) {
      fromScroll.current = false;
      focusActive(el, step.pageIndex);
      return;
    }
    const to = pageTop(el, step.pageIndex);
    if (to === null || Math.abs(el.scrollTop - to) < 4) {
      focusActive(el, step.pageIndex);
      return;
    }
    tweenStop.current?.();
    tweenStop.current = tween(el, to, SLIDE_MS, () => {
      tweenStop.current = null;
      focusActive(el, step.pageIndex);
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
  itemIndexRef.current = step?.pageIndex ?? 0;
  useEffect(() => {
    const el = colRef.current;
    if (el === null || pageHeight === null) return;
    const start = performance.now();
    let frame = 0;
    const pin = (now: number) => {
      const to = pageTop(el, itemIndexRef.current);
      if (to !== null && drag.current === null) el.scrollTop = to;
      if (now - start < RESIZE_MS + 40) frame = requestAnimationFrame(pin);
    };
    frame = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(frame);
  }, [pageHeight]);

  // The touch stream, taken natively: React registers touch listeners as
  // passive, and a passive listener cannot stop iOS from panning the
  // document - a thing it will do with the pages even though nothing in
  // the document can scroll. The handlers themselves are below, read
  // through a ref so this registers once.
  const touch = useRef({ start: (_e: TouchEvent) => {}, move: (_e: TouchEvent) => {}, end: () => {} });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const start = (e: TouchEvent) => touch.current.start(e);
    const move = (e: TouchEvent) => touch.current.move(e);
    const end = () => touch.current.end();
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
  }, [wide]);

  if (!step) return null;
  const t = step.target;
  const items = p.itemsFor(t);
  const pages = pagesForTarget(items);
  const answers = p.answers[t.id];
  const prev = firstOf(step.targetIndex - 1);
  const next = firstOf(step.targetIndex + 1);
  // Progress is in items, not pages: a Services page of six is six taps.
  const everyItem = p.steps.flatMap((s) => s.page.items.map((i) => [s.target.id, i.key] as const));
  const done = everyItem.filter(([tid, key]) => p.touched(tid, key)).length;
  const pct = everyItem.length ? Math.round((done / everyItem.length) * 100) : 0;

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
    if (itemIndex >= pages.length) {
      goLocation(step.targetIndex + 1);
      return;
    }
    p.setIndex(firstOf(step.targetIndex) + itemIndex);
  };

  /** Is this gesture an inner scroller's business - the confirmation
   *  page's review, the map page? The run sits at the bottom of its stack
   *  whenever such a page is showing, so without this every swipe over the
   *  list counted as overscroll and rolled into the next location - the
   *  list itself never moved. Once it is at its end the gesture is the
   *  run's again. */
  const innerScroller = (target: EventTarget | null, dy: number) => {
    const el = target instanceof Element ? target.closest<HTMLElement>(".wz-d-inner") : null;
    if (!el || el.scrollHeight <= el.clientHeight) return false;
    return dy > 0 ? el.scrollTop < el.scrollHeight - el.clientHeight - 1 : el.scrollTop > 1;
  };

  /** Pushing past either end of the stack rolls into the neighbouring
   *  location - the ribbon has no walls, only corners. */
  const rollOver = (forward: boolean) => {
    if (cooling.current) return;
    cooling.current = true;
    window.setTimeout(() => (cooling.current = false), SLIDE_MS + 200);
    if (forward) goLocation(step.targetIndex + 1);
    else goLocation(step.targetIndex - 1, "last");
  };

  /** Land on `page` from wherever the column is, and only then tell the run
   *  about it: the index change focuses the page's field, and a field
   *  focused before its page has arrived is one the browser scrolls into
   *  view itself, against the tween. */
  const settle = (el: HTMLDivElement, page: number) => {
    const to = pageTop(el, page);
    if (to === null) return;
    tweenStop.current?.();
    tweenStop.current = tween(el, to, SLIDE_MS, () => {
      tweenStop.current = null;
      if (page === step.pageIndex) focusActive(el, page);
      else {
        fromScroll.current = true;
        p.setIndex(firstOf(step.targetIndex) + page);
      }
    });
  };

  // The gesture. The page follows the thumb at GAIN and stops at the next
  // page; what the thumb does past that point is pressure on the end of the
  // column, which rolls the run over, or nothing. Release turns the page or
  // puts it back. Nothing here is the browser's: there is no fling, no
  // momentum, no snap, and nothing to fight the tween for scrollTop.
  const begin = (el: HTMLDivElement, y: number) => {
    tweenStop.current?.();
    tweenStop.current = null;
    const page = nearestPage(el);
    const here = pageTop(el, page) ?? el.scrollTop;
    drag.current = {
      y0: y,
      top0: here,
      page,
      lo: pageTop(el, page - 1) ?? here,
      hi: pageTop(el, page + 1) ?? here,
      spent: false,
    };
  };
  touch.current = {
    start: (e) => {
      const el = colRef.current;
      const y = e.touches[0]?.clientY;
      if (!el || y === undefined) return;
      const list = e.target instanceof Element ? e.target.closest<HTMLElement>(".wz-d-inner") : null;
      // Over the review list, the first move decides whose gesture it is.
      if (list && list.scrollHeight > list.clientHeight) drag.current = { inner: true, y0: y, decided: false };
      else begin(el, y);
    },
    move: (e) => {
      let d = drag.current;
      const el = colRef.current;
      const y = e.touches[0]?.clientY;
      if (!d || !el || y === undefined) return;
      if ("inner" in d) {
        if (d.decided) return;
        const dy = d.y0 - y;
        if (Math.abs(dy) < 4) return;
        if (innerScroller(e.target, dy)) {
          // The list's, natively, until the thumb lifts.
          d.decided = true;
          return;
        }
        // The list has nothing left this way: the run takes the gesture
        // from here. Nothing native has moved, so it can still be stopped.
        begin(el, y);
        d = drag.current;
        if (!d || "inner" in d) return;
      }
      e.preventDefault();
      if (d.spent) return;
      const want = d.top0 + (d.y0 - y) * GAIN;
      const clamped = Math.min(d.hi, Math.max(d.lo, want));
      el.scrollTop = clamped;
      // Pressure past the end of the column, in thumb pixels.
      const excess = (want - clamped) / GAIN;
      const atEnd = (excess < 0 && d.lo === d.top0) || (excess > 0 && d.hi === d.top0);
      if (atEnd && Math.abs(excess) >= EDGE) {
        d.spent = true;
        rollOver(excess > 0);
      }
    },
    end: () => {
      const d = drag.current;
      const el = colRef.current;
      drag.current = null;
      if (!d || "inner" in d || !el || d.spent) return;
      const moved = el.scrollTop - d.top0;
      const span = moved > 0 ? d.hi - d.top0 : d.top0 - d.lo;
      const turned = span > 0 && Math.abs(moved) >= span * TURN_AT;
      settle(el, d.page + (turned ? Math.sign(moved) : 0));
    },
  };

  /** A wheel burst turns one page. There is no release to decide on, so
   *  the first WHEEL_STEP of delta decides and the rest of the burst cools. */
  const onWheel = (e: React.WheelEvent) => {
    if (innerScroller(e.target, e.deltaY) || cooling.current || tweenStop.current) return;
    wheelAcc.current += e.deltaY;
    if (Math.abs(wheelAcc.current) < WHEEL_STEP) return;
    const forward = wheelAcc.current > 0;
    wheelAcc.current = 0;
    cooling.current = true;
    window.setTimeout(() => (cooling.current = false), 250);
    goItem(step.pageIndex + (forward ? 1 : -1));
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
              onAdvance={() => goItem(step.pageIndex + 1)}
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
            onWheel={onWheel}
          >
            <div className="wz-d-rail">
              <button type="button" className="wz-d-arrow" data-testid="wz-up" aria-label="previous item" onClick={() => goItem(step.pageIndex - 1)}>
                ▲
              </button>
              <div className="wz-d-pips">
                {pages.map((pg, i) => (
                  <button
                    key={pg.key}
                    type="button"
                    title={pg.label}
                    aria-label={pg.label}
                    data-testid="wz-pip"
                    className={`wz-d-pip ${i === step.pageIndex ? "now" : pg.items.some((it) => p.touched(t.id, it.key)) ? "done" : answeredCount(pg.items, answers) === pg.items.length ? "onfile" : ""}`}
                    onClick={() => goItem(i)}
                  />
                ))}
              </div>
              <button type="button" className="wz-d-arrow" data-testid="wz-down" aria-label="next item" onClick={() => goItem(step.pageIndex + 1)}>
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
              activeIndex={step.pageIndex}
              startAt={justSlid.current ? step.pageIndex : undefined}
              scrollRef={colRef}
              onAdvance={() => goItem(step.pageIndex + 1)}
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
                {item.kind === "map" ? "On the map" : item.label}
                {onFile && <span className="muted small" style={{ fontWeight: 400 }}> · on file: {onFile}</span>}
              </div>
              <ItemControl item={item} target={t} value={value} statuses={p.statuses} advance={onAdvance} onChange={(v, mode) => p.setAnswer(t.id, item.key, v, mode)} />
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
  const pages = pagesForTarget(p.itemsFor(target));
  const answers = p.answers[target.id];
  return (
    <div
      className={className}
      ref={(el) => {
        own.current = el;
        if (scrollRef) scrollRef.current = el;
      }}
    >
      {pages.map((page, i) => {
        const item = page.items[0];
        const onFile = page.kind === "item" ? p.onFile(target, item) : null;
        const tall = page.kind === "section" || item.kind === "map";
        return (
          <section className={`wz-d-page ${item.kind === "confirm" ? "wz-d-confirm" : tall ? "wz-d-tall" : ""}`} key={page.key} data-page={i}>
            <div className="wz-d-heading">
              <h1 className="wz-d-loc">{target.location_name}</h1>
              {target.type_name && <div className="wz-d-type">{target.type_name}</div>}
              <div className="wz-d-rule" aria-hidden />
              <div className="wz-d-group">{page.kind === "section" ? `${page.items.length} to check` : item.group}</div>
              <div className="wz-d-label">{pageHeading(page)}</div>
            </div>
            {page.kind === "section" ? (
              <SectionPage page={page} target={target} p={p} answers={answers} onAdvance={() => onAdvance?.()} />
            ) : item.kind === "confirm" ? (
              <ConfirmPage t={target} p={p} onDone={onConfirmed} />
            ) : (
              // A page taller than the screen - the map - scrolls inside
              // itself, like the confirmation page's review.
              <div className={item.kind === "map" ? "wz-d-inner" : "wz-d-body"}>
                <ItemControl
                  item={item}
                  target={target}
                  value={answers?.[item.key]}
                  statuses={p.statuses}
                  big
                  autoFocus={i === activeIndex}
                  advance={onAdvance}
                  onChange={(v, mode) => p.setAnswer(target.id, item.key, v, mode)}
                />
                {onFile && <div className="wz-a-prefill">On file: {onFile}</div>}
              </div>
            )}
            <div className="muted small">
              {i + 1} of {pages.length} here · {p.savedNote}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Every item of a group on one page - Attributes, Services, Amenities -
 *  the way the Finding form lists them: it is faster to tap them in the
 *  order they are seen than to meet each one on its own screen (owner,
 *  2026-10-04). The list scrolls inside the page; the button at its foot
 *  moves on, as does a swipe. */
function SectionPage({
  page,
  target,
  p,
  answers,
  onAdvance,
}: {
  page: WizardPage;
  target: WizardTarget;
  p: RunProps;
  answers: RunProps["answers"][string] | undefined;
  onAdvance: () => void;
}) {
  return (
    <div className="wz-d-inner wz-section" data-testid="wz-section">
      {page.items.map((item: WizardItem) => {
        const onFile = p.onFile(target, item);
        return (
          <div key={item.key} className={`wz-b-row ${p.touched(target.id, item.key) ? "done" : ""}`} data-testid="wz-section-row">
            <div className="wz-b-row-label">
              {item.label}
              {onFile && <span className="muted small" style={{ fontWeight: 400 }}> · on file: {onFile}</span>}
            </div>
            <ItemControl item={item} target={target} value={answers?.[item.key]} statuses={p.statuses} onChange={(v, mode) => p.setAnswer(target.id, item.key, v, mode)} />
          </div>
        );
      })}
      <div className="wz-section-foot">
        <button type="button" className="btn btn-primary wz-btn-big" data-testid="wz-section-next" onClick={onAdvance}>
          Next
        </button>
      </div>
    </div>
  );
}

/** What a page is headed. The map page's item is "Placed correctly on the
 *  map?" on the setup screen, but the page asks that under the map, and
 *  only when there is a placement to ask about. */
function pageHeading(page: WizardPage): string {
  return page.kind === "item" && page.items[0].kind === "map" ? "On the map" : page.label;
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
 *  no duration we can set. Returns a stop: a thumb landing mid-tween takes
 *  the page from wherever it is. */
function tween(el: HTMLElement, to: number, ms: number, done: () => void): () => void {
  const from = el.scrollTop;
  if (Math.abs(to - from) < 1) {
    done();
    return () => {};
  }
  let stopped = false;
  const start = performance.now();
  const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  const frame = (now: number) => {
    if (stopped) return;
    const k = Math.min(1, (now - start) / ms);
    el.scrollTop = from + (to - from) * ease(k);
    if (k < 1) requestAnimationFrame(frame);
    else done();
  };
  requestAnimationFrame(frame);
  return () => {
    stopped = true;
  };
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
    // The page is already where it belongs; the browser must not move it.
    field.focus({ preventScroll: true });
    return;
  }
  if (here) (active as HTMLElement).blur();
}
