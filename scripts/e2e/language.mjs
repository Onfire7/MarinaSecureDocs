// End-to-end drive of the language picker and keys mode
// (docs/localization.md § Two languages, § Keys mode), test 9 of the
// approved list. Run against the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/language.mjs
//
// Only English ships today, so the language that is picked is English; what
// is under test is where the choice is kept and that it is obeyed, not the
// translation. The switch to another language is unit-tested with fixture
// catalogs (src/i18n/localizer.test.ts).
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OUT = "/tmp/pw-test/screenshots";
const sql = (q) => execSync(`psql "${DB}" -Atc ${JSON.stringify(q.replace(/\s+/g, " "))}`).toString().trim();
const MY_LANGUAGE = `select coalesce(language, '<null>') from users where email = 'gpp@onfire.us'`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok " : "NOT ok"} ${name}${detail ? " — " + detail : ""}`);
};

async function until(what, query, expected, timeout = 30000) {
  const end = Date.now() + timeout;
  let got;
  while (Date.now() < end) {
    got = sql(query);
    if (got === expected) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`   (timed out waiting for ${what}: got ${JSON.stringify(got)})`);
  return false;
}

function watch(page, errors) {
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 200)));
  page.on("response", async (r) => {
    if (r.status() >= 400 && !r.url().includes("clerk")) errors.push(`${r.status()} ${r.url().slice(0, 100)} ${(await r.text().catch(() => "")).slice(0, 160)}`);
  });
}

sql(`update users set language = null where email = 'gpp@onfire.us'`);

const browser = await chromium.launch();
const errors = [];
const context = await browser.newContext({ storageState: "/tmp/pw-test/state.json", viewport: { width: 430, height: 900 } });
const page = await context.newPage();
watch(page, errors);
// The sidenav carries a second, hidden copy at this width; use the visible one.
const VISIBLE_PICKER = '[data-testid="language-select"]:visible';
const picker = () => page.locator(VISIBLE_PICKER);

// ── The choice is written to the user's row ───────────────────────────────
await page.goto(`${APP_URL}/more?lng=`);
await picker().waitFor();
check("with no choice made, the picker reads Device default", (await picker().inputValue()) === "");
await picker().selectOption("en");
check("picking a language writes users.language", await until("users.language = en", MY_LANGUAGE, "en"));

await page.reload();
await picker().waitFor();
check("the choice survives a reload", (await picker().inputValue()) === "en");
await page.screenshot({ path: `${OUT}/language-picked.png` });

// ── …and is read back from it, not from this browser ──────────────────────
// A fresh context with the device cache removed: the only place left that
// knows the choice is the synced user row.
const fresh = await browser.newContext({ storageState: "/tmp/pw-test/state.json", viewport: { width: 430, height: 900 } });
await fresh.addInitScript(() => {
  if (!sessionStorage.getItem("cleared")) {
    localStorage.removeItem("ms.lng");
    sessionStorage.setItem("cleared", "1");
  }
});
const page2 = await fresh.newPage();
watch(page2, errors);
await page2.goto(`${APP_URL}/more`);
const picker2 = () => page2.locator(VISIBLE_PICKER);
await picker2().waitFor();
await page2.waitForFunction(() => localStorage.getItem("ms.lng") === "en", null, { timeout: 15000 }).catch(() => {});
check("a new browser applies the user's language from the database",
  (await picker2().inputValue()) === "en"
    && (await page2.evaluate(() => localStorage.getItem("ms.lng"))) === "en",
  `select=${await picker2().inputValue()} html lang=${await page2.evaluate(() => document.documentElement.lang)}`);

// ── Clearing it ───────────────────────────────────────────────────────────
await picker().selectOption("");
check("choosing Device default clears users.language", await until("users.language = null", MY_LANGUAGE, "<null>"));

// ── Keys mode ─────────────────────────────────────────────────────────────
await page.goto(`${APP_URL}/more?lng=keys`);
await picker().waitFor();
const keyed = await page.locator("body").innerText();
check("?lng=keys renders catalog keys in place of copy", keyed.includes("common:language"), keyed.match(/common:\S+/)?.[0] ?? "no keys on screen");
await page.screenshot({ path: `${OUT}/language-keys.png` });

await page.goto(`${APP_URL}/more`);
await picker().waitFor();
check("keys mode sticks without the parameter", (await page.locator("body").innerText()).includes("common:language"));

await page.goto(`${APP_URL}/more?lng=`);
await picker().waitFor();
const plain = await page.locator("body").innerText();
check("?lng= brings the copy back", plain.includes("Language") && !plain.includes("common:language"));

await browser.close();
check("no page errors, console errors or failed requests", errors.length === 0, errors.join(" | "));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
