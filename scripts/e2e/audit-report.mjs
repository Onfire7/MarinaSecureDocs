// End-to-end drive of sharing an audit's results, against a running app
// signed in with the state agent-login.mjs saved. Tests 16-18 of the list
// approved 2026-09-23 (docs/audits.md § Sharing the results). Run against
// the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   psql "$DB" -f scripts/e2e/seed-audit-report.sql
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/audit-report.mjs
//
// It creates and revokes a Share Link. Against the marina's real database
// that is a real row; the loop runs locally.
import { chromium } from "playwright";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OUT = "/tmp/pw-test/screenshots";
const sql = (q) => execSync(`psql "${DB}" -Atc ${JSON.stringify(q.replace(/\s+/g, " "))}`).toString().trim();

const stamp = Date.now().toString(36);
const LABEL = `E2E ownership group ${stamp}`;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok " : "NOT ok"} ${name}${detail ? " — " + detail : ""}`);
};

const auditId = sql(`select id from audits where name = 'Campground & B Dock status - Sept 2026' and status = 'closed'`);
if (!auditId) {
  console.error("Seed first: psql -f scripts/e2e/seed-audit-report.sql");
  process.exit(2);
}

const browser = await chromium.launch();
const errors = [];
const watch = (page, tag) => {
  page.on("pageerror", (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Sync error/.test(m.text()) && errors.push(`${tag} console: ${m.text().slice(0, 200)}`));
  page.on("response", async (r) => {
    if (r.status() >= 400 && !r.url().includes("clerk")) errors.push(`${tag} ${r.status()} ${r.url().slice(0, 100)} ${(await r.text().catch(() => "")).slice(0, 160)}`);
  });
};

// ── 16: share, then open the link signed out ─────────────────────────────
const signedIn = await browser.newContext({ storageState: "/tmp/pw-test/state.json", viewport: { width: 1280, height: 900 } });
await signedIn.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await signedIn.newPage();
watch(page, "app");
await page.goto(`${APP_URL}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="create-share"]', { timeout: 120000 });
await page.getByLabel("Share label").fill(LABEL);
await page.getByTestId("create-share").click();
await page.waitForSelector('[data-testid="share-url"]', { timeout: 30000 });
const url = (await page.getByTestId("share-url").innerText()).trim();
check("16a share link created and shown", /\/r\/[0-9a-f-]{36}$/.test(url), url);
check("16b the link is listed with its label", (await page.locator('[data-testid="share-row"]').filter({ hasText: LABEL }).count()) === 1);
await page.screenshot({ path: `${OUT}/report-share-card.png` });

const anon = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const pub = await anon.newPage();
watch(pub, "public");
const requests = [];
pub.on("request", (r) => requests.push(r.url()));
await pub.goto(url, { waitUntil: "domcontentloaded" });
await pub.waitForSelector('[data-testid="report-summary"]', { timeout: 60000 });
const text = await pub.locator("body").innerText();
check("16c the public page renders the report", /Campground & B Dock status/.test(text) && /EXECUTIVE SUMMARY/i.test(text) && /Needs attention/i.test(text));
check("16d the first summary sentence", /of 50 locations were audited/.test(text), text.match(/\d+ of 50 locations[^.]*\./)?.[0] ?? "");
check("16e the per-location table has a Shore power column", (await pub.locator('[data-testid="report-locations"] th', { hasText: "Shore power" }).count()) === 1);
check("16f no request went to Clerk or PowerSync", !requests.some((u) => /clerk|powersync/i.test(u)), requests.filter((u) => /clerk|powersync/i.test(u)).join(" "));
check("16g no sign-in on the public page", !/Sign in/.test(text));
await pub.screenshot({ path: `${OUT}/report-public.png`, fullPage: true });

const inApp = await signedIn.newPage();
watch(inApp, "in-app");
await inApp.goto(`${APP_URL}/audits/${auditId}/report`, { waitUntil: "domcontentloaded" });
await inApp.waitForSelector('[data-testid="report-summary"]', { timeout: 60000 });
const inAppText = await inApp.locator('[data-testid="report-summary"]').innerText();
check("16h the in-app report shows the same numbers", inAppText.split("\n")[0] === text.match(/\d+ of 50 locations[^\n]*/)?.[0], inAppText.split("\n")[0]);
check("16i in-app rows link to their findings", (await inApp.locator('[data-testid="report-locations"] a[href*="/targets/"]').count()) > 0);
await inApp.screenshot({ path: `${OUT}/report-in-app.png` });
await inApp.close();

// ── 17: filters, tabs, export ────────────────────────────────────────────
const before = await pub.locator('[data-testid="report-locations"] tbody tr').count();
await pub.getByLabel("Show").selectOption("attention");
const after = await pub.locator('[data-testid="report-locations"] tbody tr').count();
check("17a 'Needs attention' reduces the rows", after > 0 && after < before, `${before} → ${after}`);
await pub.getByTestId("report-tab-items").click();
check("17b the per-item tab has a Category column", (await pub.locator('[data-testid="report-items"] th', { hasText: "Category" }).count()) === 1);
await pub.getByLabel("Show").selectOption("all");

await pub.addInitScript(() => {
  window.print = () => {
    window.__printed = true;
  };
});
await pub.reload({ waitUntil: "domcontentloaded" });
await pub.waitForSelector('[data-testid="report-summary"]', { timeout: 60000 });
await pub.getByTestId("report-export").click();
await pub.getByLabel("PDF (print)").check();
await pub.getByLabel("Rows").selectOption("both");
const downloads = [];
pub.on("download", (d) => downloads.push(d));
await pub.getByTestId("report-export-run").click();
await pub.waitForFunction(() => window.__printed === true, null, { timeout: 15000 }).catch(() => {});
await pub.waitForTimeout(2500);
const names = await Promise.all(downloads.map((d) => d.suggestedFilename()));
check("17c three files: two CSVs and a workbook", names.filter((n) => n.endsWith(".csv")).length === 2 && names.some((n) => n.endsWith(".xlsx")), names.join(", "));
const locCsv = downloads.find((d) => d.suggestedFilename().endsWith("locations.csv"));
if (locCsv) {
  const csv = readFileSync(await locCsv.path(), "utf8");
  const header = csv.split("\n")[0];
  check("17d the CSV header is the wide table's, State included", /^Location,Area,Type,State,/.test(header) && /Shore power 30A/.test(header) && /Marked,Map,Notes,Changes,Tickets,Recorded by,Recorded at$/.test(header), header);
}
const xlsx = downloads.find((d) => d.suggestedFilename().endsWith(".xlsx"));
if (xlsx) {
  const buf = readFileSync(await xlsx.path());
  const zipNames = buf.toString("latin1");
  check("17e the workbook has Summary, Locations and Items sheets", /sheet1\.xml/.test(zipNames) && /sheet3\.xml/.test(zipNames), `${buf.length} bytes`);
}
check("17f PDF called the browser's print", await pub.evaluate(() => window.__printed === true));

// ── 18: revoke ───────────────────────────────────────────────────────────
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="share-row"]', { timeout: 60000 });
const row = page.locator('[data-testid="share-row"]').filter({ hasText: LABEL });
const views = Number((await row.getByTestId("share-views").innerText()).trim());
check("18a the audit page counts the views", views >= 2, `${views} views`);
page.once("dialog", (d) => d.accept());
await row.getByTestId("revoke-share").click();
await page.waitForTimeout(1500);
await pub.goto(url, { waitUntil: "domcontentloaded" });
await pub.waitForSelector('[data-testid="report-gone"]', { timeout: 30000 });
check("18b the revoked link shows the neutral page", /no longer active/.test(await pub.locator("body").innerText()));
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="share-row"]', { timeout: 60000 });
check("18c the revoked link stays listed, struck through", (await page.locator('[data-testid="share-row"]').filter({ hasText: LABEL }).evaluate((el) => getComputedStyle(el).textDecorationLine)) === "line-through");

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (errors.length) console.log("--- errors ---\n" + errors.join("\n"));
process.exit(failed.length || errors.length ? 1 : 0);
