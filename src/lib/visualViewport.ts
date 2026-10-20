// Mirrors the visual viewport — the part of the page actually on screen —
// into CSS variables so fixed overlays (.dialog-backdrop) can center in it.
// position: fixed anchors to the layout viewport, which an on-screen
// keyboard doesn't shrink on iOS Safari or modern Android Chrome, so a
// dialog centered there ends up half under the keyboard.
//
// Imported for its side effect from main.tsx. Without visualViewport the
// variables stay unset and the CSS falls back to the full layout viewport.

function sync(vv: VisualViewport) {
  const root = document.documentElement.style;
  root.setProperty("--vv-top", `${vv.offsetTop}px`);
  root.setProperty("--vv-height", `${vv.height}px`);
}

if (typeof window !== "undefined" && window.visualViewport) {
  const vv = window.visualViewport;
  sync(vv);
  // iOS scrolls the visual viewport within the layout viewport when the
  // keyboard opens, so offsetTop moves as well as height.
  vv.addEventListener("resize", () => sync(vv));
  vv.addEventListener("scroll", () => sync(vv));
}
