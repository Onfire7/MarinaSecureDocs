// Language coverage report (docs/localization.md § Keys mode).
//
// Signs in with the saved agent-login.mjs session, switches the app to keys
// mode, and walks every screen reachable by following links — one page per
// route shape, so /tickets/<id> is visited once, not once per ticket. On each
// it collects the visible text and the placeholder / title / aria-label / alt
// attributes, drops what is a catalog key or has no letters in it, and
// writes the rest, per route, to /tmp/pw-test/i18n-coverage.txt, with a
// screenshot of each route.
//
// What is left is data or untranslated copy, and only a reader can tell
// which: a boat name is readable text too. So this is a report, not a gate.
// Recurring data (the test account's name, seeded location names) goes in
// i18n-coverage.ignore, one exact string or /regex/ per line.
//
// It follows links only — it never presses a button — and it skips
// /checkin/<guid>, which records a check-in just by being opened.
//
//   node scripts/agent-login.mjs            # or APP_URL=… for another deployment
//   node scripts/e2e/i18n-coverage.mjs      # APP_URL defaults to beta2
//
// Snapshot mode proves a conversion changed no English. SNAPSHOT=<file>
// crawls in English instead and writes every route's full text, unfiltered
// and in page order, as JSON. PATHS=<earlier snapshot> visits exactly the
// pages that one did, so before and after compare like for like:
//
//   SNAPSHOT=/tmp/pw-test/en-before.json node scripts/e2e/i18n-coverage.mjs
//   … convert, deploy …
//   SNAPSHOT=/tmp/pw-test/en-after.json PATHS=/tmp/pw-test/en-before.json node scripts/e2e/i18n-coverage.mjs
//
// MOBILE=1 crawls at phone width, where the shell is a tab bar and More page.
// Live values (the clock, shift duration, counts) differ between runs, so
// read the diff rather than expecting it empty.
import { chromium } from "playwright";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APP_URL = process.env.APP_URL ?? "https://beta2.marinasecure.com";
const MAX_PAGES = Number(process.env.MAX_PAGES ?? 150);
const OUT = "/tmp/pw-test/i18n-coverage.txt";
const SHOTS = "/tmp/pw-test/screenshots/i18n";
const SNAPSHOT = process.env.SNAPSHOT;
const PATHS = process.env.PATHS;
const VIEWPORT = process.env.MOBILE ? { width: 430, height: 900 } : { width: 1280, height: 900 };
const SKIP = [/^\/checkin\//, /^\/sign-in/, /^\/switch-user/, /^\/r\//];

const here = dirname(fileURLToPath(import.meta.url));
const ignore = readFileSync(join(here, "i18n-coverage.ignore"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => (l.startsWith("/") && l.endsWith("/") && l.length > 2 ? new RegExp(l.slice(1, -1)) : l));
const ignored = (s) => ignore.some((i) => (typeof i === "string" ? i === s : i.test(s)));

const KEY = /^[a-z][A-Za-z0-9]*:[A-Za-z0-9_.]+$/;
/** Route shape: ids and numbers collapse, so each kind of page is visited once. */
const shape = (path) =>
  path
    .split("/")
    .map((seg) => (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(seg) ? ":id" : /^\d+$/.test(seg) ? ":n" : seg))
    .join("/");

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "/tmp/pw-test/state.json", viewport: VIEWPORT });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`${page.url()} pageerror: ${e.message}`));

// Not "networkidle": PowerSync holds a streaming connection open, so the
// network is never idle and every page would wait out the full timeout.
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 1500);

await page.goto(`${APP_URL}/?lng=${SNAPSHOT ? "" : "keys"}`);
await page.waitForTimeout(SETTLE_MS * 2);

const fixed = PATHS && existsSync(PATHS) ? Object.keys(JSON.parse(readFileSync(PATHS, "utf8")).routes) : null;
const queue = fixed ? [...fixed] : ["/"];
const snapshot = {};
const seen = new Set();
const report = [];
// Each string is reported on the first route it appears on only, so the
// shell's navigation is listed once rather than on every page.
const reported = new Set();
let total = 0;

while (queue.length && seen.size < MAX_PAGES) {
  const path = queue.shift();
  if (!fixed && seen.has(shape(path))) continue;
  seen.add(shape(path));

  await page.goto(APP_URL + path);
  await page.waitForTimeout(SETTLE_MS);

  const { texts, links } = await page.evaluate(() => {
    const out = [];
    const visible = (el) => el && el.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent.replace(/\s+/g, " ").trim();
      if (t && visible(n.parentElement) && !n.parentElement.closest("script,style")) out.push(t);
    }
    for (const el of document.querySelectorAll("[placeholder],[title],[aria-label],[alt]")) {
      for (const a of ["placeholder", "title", "aria-label", "alt"]) {
        const v = el.getAttribute(a)?.trim();
        if (v) out.push(`[${a}] ${v}`);
      }
    }
    const links = [...document.querySelectorAll("a[href]")]
      .map((a) => new URL(a.href, location.href))
      .filter((u) => u.origin === location.origin)
      .map((u) => u.pathname);
    return { texts: out, links };
  });

  if (SNAPSHOT) {
    snapshot[path] = texts;
    console.log(`${String(texts.length).padStart(4)}  ${path}`);
    if (!fixed) for (const l of links) if (!SKIP.some((r) => r.test(l)) && !seen.has(shape(l))) queue.push(l);
    continue;
  }

  const suspects = texts.filter((t) => {
    const bare = t.replace(/^\[[a-z-]+\] /, "");
    return /[A-Za-z]{2}/.test(bare) && !KEY.test(bare) && !ignored(bare) && !reported.has(t);
  });
  for (const t of suspects) reported.add(t);
  total += suspects.length;
  const file = shape(path).replace(/[/:]/g, "_") || "_";
  await page.screenshot({ path: `${SHOTS}/${file}.png`, fullPage: true });
  report.push(`## ${shape(path)}   (${path})\n${suspects.map((s) => `  ${s}`).join("\n") || "  (nothing)"}\n`);
  console.log(`${String(suspects.length).padStart(4)}  ${shape(path)}`);

  for (const l of links) if (!SKIP.some((r) => r.test(l)) && !seen.has(shape(l))) queue.push(l);
}

if (SNAPSHOT) {
  await browser.close();
  writeFileSync(SNAPSHOT, JSON.stringify({ url: APP_URL, viewport: VIEWPORT, at: new Date().toISOString(), routes: snapshot }, null, 1));
  console.log(`\n${Object.keys(snapshot).length} pages → ${SNAPSHOT}`);
  process.exit(0);
}

// Leave the saved session's browser out of keys mode.
await page.goto(`${APP_URL}/?lng=`);
await browser.close();

writeFileSync(
  OUT,
  `Language coverage — ${APP_URL} — ${new Date().toISOString()}\n` +
    `${seen.size} route shapes, ${total} readable strings that are not catalog keys,\n` +
    `each listed under the first route it appeared on.\n` +
    `Each is data or untranslated copy; only a reader can tell which.\n\n` +
    report.join("\n") +
    (errors.length ? `\n## page errors\n${errors.map((e) => "  " + e).join("\n")}\n` : ""),
);
console.log(`\n${seen.size} routes, ${total} strings to review → ${OUT}\nscreenshots → ${SHOTS}/`);
if (queue.length) console.log(`(stopped at MAX_PAGES=${MAX_PAGES}; ${queue.length} links not followed)`);
