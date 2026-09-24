import { useEffect, type RefObject } from "react";
import { visiblePageHeight } from "../../../lib/auditWizard";

/**
 * Watch how much of the run's scroller the on-screen keyboard leaves
 * visible, and hand it back in pixels.
 *
 * The wizard does not let the keyboard resize the viewport - the location
 * pager is meant to go under it - so the layout viewport says nothing.
 * `window.visualViewport` does: its height excludes the keyboard, and on
 * iOS its offsetTop says how far the browser has scrolled it inside the
 * layout. Both events matter; Android fires resize, iOS fires both.
 *
 * Nothing here can be exercised headlessly - Chromium has no on-screen
 * keyboard and the protocol will not fake one - so the arithmetic lives in
 * `visiblePageHeight()`, which is tested, and this hook is the wiring.
 */
export function useVisiblePageHeight(ref: RefObject<HTMLElement | null>, onChange: (px: number) => void) {
  useEffect(() => {
    const view = window.visualViewport;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      onChange(
        visiblePageHeight(
          { top: rect.top, height: rect.height },
          view ? { offsetTop: view.offsetTop, height: view.height } : { offsetTop: 0, height: window.innerHeight },
        ),
      );
    };
    measure();
    view?.addEventListener("resize", measure);
    view?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      view?.removeEventListener("resize", measure);
      view?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [ref, onChange]);
}
