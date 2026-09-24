// What the on-screen keyboard does to a wizard run
// (AuditWizardPage.spec.md § Running - phone).
//
// Headless Chromium has no keyboard and the protocol will not fake one, so
// this substitutes the visual viewport: the same object the app reads, with
// a height that can be taken away and given back. It proves the wiring -
// that the scroller, the rail and the pages follow what is visible, that
// the item being answered stays put, and that a gesture still moves items
// rather than panning the layer. It cannot prove how Android's own keyboard
// animation lines up with ours; that wants the Pixel.
//
//   psql "$DB" -f scripts/e2e/seed-audit-wizard.sql
//   APP_URL=http://localhost:5173 node scripts/e2e/audit-wizard-keyboard.mjs
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = (q) => execSync(`psql "${DB}" -Atc ${JSON.stringify(q.replace(/\s+/g, " "))}`).toString().trim();
const KEYBOARD = 320;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok " : "NOT ok"} ${name}${detail ? " — " + detail : ""}`);
};

const auditId = sql(`select id from audits where name = 'Wizard e2e' and status = 'open'`);
if (!auditId) {
  console.error("Seed first: psql -f scripts/e2e/seed-audit-wizard.sql");
  process.exit(2);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  storageState: "/tmp/pw-test/state.json",
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
await ctx.addInitScript(() => {
  const listeners = new Set();
  let keyboard = 0;
  // Measured when asked, not when installed: at document-start the layout
  // viewport is not the one the page ends up with.
  const fake = {
    get height() {
      return window.innerHeight - keyboard;
    },
    get width() {
      return window.innerWidth;
    },
    offsetTop: 0,
    addEventListener: (_t, f) => listeners.add(f),
    removeEventListener: (_t, f) => listeners.delete(f),
  };
  Object.defineProperty(window, "visualViewport", { value: fake, configurable: true });
  window.__keyboard = (px) => {
    keyboard = px;
    listeners.forEach((f) => f());
  };
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !/Sync error/.test(m.text()) && errors.push("console: " + m.text().slice(0, 160)));
const settle = (ms = 1200) => page.waitForTimeout(ms);

const geom = () =>
  page.evaluate(() => {
    const wrap = document.querySelector(".wz-d-wrap");
    const col = document.querySelector(".wz-d-col:not([class*=wz-out])");
    const rail = document.querySelector(".wz-d-rail");
    const pips = [...rail.querySelectorAll("[data-testid=wz-pip]")];
    const pages = [...col.querySelectorAll("[data-page]")];
    let best = 0;
    let gap = Infinity;
    pages.forEach((pg, i) => {
      const g = Math.abs(pg.offsetTop - col.scrollTop);
      if (g < gap) {
        gap = g;
        best = i;
      }
    });
    const railBox = rail.getBoundingClientRect();
    const pipsBox = {
      top: Math.min(...pips.map((p) => p.getBoundingClientRect().top)),
      bottom: Math.max(...pips.map((p) => p.getBoundingClientRect().bottom)),
    };
    return {
      visible: Math.round(window.visualViewport.height),
      wrapTop: Math.round(wrap.getBoundingClientRect().top),
      colH: Math.round(col.getBoundingClientRect().height),
      railH: Math.round(railBox.height),
      pipsMid: Math.round((pipsBox.top + pipsBox.bottom) / 2),
      pageH: Math.round(pages[best].getBoundingClientRect().height),
      page: best,
      label: pages[best].querySelector(".wz-d-label")?.textContent,
      pinned: Math.abs(col.scrollTop - pages[best].offsetTop) < 2,
      scrollH: col.scrollHeight,
      docScrollable: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    };
  });

await page.goto(`${APP_URL}/audits/${auditId}/wizard`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="wz-start"]', { timeout: 120000 });
await page.getByTestId("wz-start").click();
await page.waitForSelector('[data-testid="wz-pip"]', { timeout: 60000 });
await settle(1500);
await page.locator('[data-testid="wz-pip"]').nth(4).click();
await settle();

const before = await geom();
check("1 no keyboard: the scroller is the whole area", before.colH > 600, `${before.colH}px`);
check("2 the document itself does not scroll", !before.docScrollable);
const midOf = (g) => Math.round(g.wrapTop + g.colH / 2);
check("3 the pips are centred in it", Math.abs(before.pipsMid - midOf(before)) < 20, `pips ${before.pipsMid}, middle ${midOf(before)}`);

await page.evaluate((px) => window.__keyboard(px), KEYBOARD);
await settle(150);
const mid = await geom();
await settle(500);
const up = await geom();
const expected = Math.min(before.colH, before.visible - KEYBOARD - before.wrapTop);
check("4 the scroller ends where the keyboard starts", Math.abs(up.colH - expected) < 3, `${before.colH} → ${up.colH}, expected ${expected}`);
check("5 and gets there over the animation", mid.colH > up.colH && mid.colH < before.colH, `${before.colH} → ${mid.colH} → ${up.colH}`);
check("6 the page is the scroller", Math.abs(up.pageH - up.colH) < 3, `${up.pageH} vs ${up.colH}`);
check("7 nothing of the run is left under the keyboard", up.colH + before.wrapTop <= before.visible - KEYBOARD + 2, `bottom at ${up.colH + before.wrapTop}, keyboard at ${before.visible - KEYBOARD}`);
check("8 the pips re-centre in what is visible", Math.abs(up.pipsMid - midOf(up)) < 20, `pips ${up.pipsMid}, middle ${midOf(up)}`);
check("9 the item being answered is still the one on screen", up.page === before.page && up.pinned, up.label ?? "");
await page.screenshot({ path: "/tmp/pw-test/screenshots/wizard-keyboard.png" });

// A gesture must move an item, not pan the layer.
await page.mouse.move(195, before.wrapTop + 80);
await page.mouse.wheel(0, up.colH);
await settle(1200);
const scrolled = await geom();
check("10 a scroll moves to the next item", scrolled.page === before.page + 1, `${before.label} → ${scrolled.label}`);
check("11 and lands on it squarely", scrolled.pinned && Math.abs(scrolled.pageH - up.colH) < 3);

await page.evaluate(() => window.__keyboard(0));
await settle(600);
const back = await geom();
check("12 closing it gives the height back", Math.abs(back.colH - before.colH) < 3 && back.pinned, `${up.colH} → ${back.colH}`);
check("13 the pips go back to centre", Math.abs(back.pipsMid - midOf(back)) < 20, `pips ${back.pipsMid}, middle ${midOf(back)}`);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (errors.length) console.log("--- errors ---\n" + errors.join("\n"));
process.exit(failed.length || errors.length ? 1 : 0);
