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

// ── 19: a filtered link (docs/audits.md § A link can show less) ──────────
// Tests 12-14 of the list approved 2026-09-24. The point is not that the
// page hides things - it is that the document never had them, so there is
// nothing to find in the source, the export, or the numbers.
await page.goto(`${APP_URL}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="create-share"]', { timeout: 120000 });
await page.waitForSelector('[data-testid="share-filter-toggle"]', { timeout: 30000 });
await page.waitForTimeout(1500);
await page.getByTestId("share-filter-toggle").click();
await page.waitForSelector('[data-testid="share-filter"]', { timeout: 10000 });
// hide GPS, hide one Service by name, and keep only the first few locations
await page.locator('[data-testid="share-cat"][data-cat="gps"]').uncheck();
const svcRow = page.locator("label.share-filter-row", { hasText: "Shore power 30A" }).first();
await svcRow.locator('[data-testid="share-entry"]').uncheck();
const targets = page.locator('[data-testid="share-target"]');
const targetCount = await targets.count();
for (let i = 4; i < targetCount; i++) await targets.nth(i).uncheck();
const shownNow = await page.locator('[data-testid="share-target"]:checked').count();
await page.locator('input[aria-label="Share label"]').fill(`Filtered ${stamp}`);
await page.getByTestId("create-share").click();
await page.waitForSelector('[data-testid="share-url"]', { timeout: 30000 });
const filteredUrl = (await page.getByTestId("share-url").innerText()).trim();
// the newest link is the last row: the table is in creation order
const shows = await page.locator('[data-testid="share-shows"]').last().innerText();
check("19a the link's row says what it leaves out", /hides GPS, Shore power 30A/.test(shows) && /\d+ of \d+ locations/.test(shows), shows);

const fpub = await browser.newContext();
const fp = await fpub.newPage();
await fp.goto(filteredUrl, { waitUntil: "domcontentloaded" });
await fp.waitForSelector('[data-testid="report-summary"]', { timeout: 60000 });
await fp.waitForTimeout(1500);
const body = await fp.locator("body").innerText();
const html = await fp.content();
check("19b the hidden Service is nowhere on the page, nor in its source",
  !/Shore power 30A/.test(body) && !/Shore power 30A/.test(html), (body.match(/Shore power[^\n]*/) ?? ["absent"])[0]);
check("19c a Service that was not hidden is still there", /Water/.test(body));
const rowCount = Number((await fp.getByTestId("report-count").innerText()).split(" of ")[1]);
check("19d only the locations the link covers, and the totals are of that subset",
  rowCount === shownNow && new RegExp(`\\b${shownNow}\\b`).test(await fp.locator('[data-testid="report-summary"]').innerText()),
  `${rowCount} rows, link covers ${shownNow}`);

const fdl = [];
fp.on("download", (d) => fdl.push(d));
await fp.getByTestId("report-export").click();
await fp.getByLabel("Rows").selectOption("locations");
await fp.getByTestId("report-export-run").click();
await fp.waitForTimeout(2500);
const fcsv = fdl.find((d) => d.suggestedFilename().endsWith("locations.csv"));
if (fcsv) {
  const text = readFileSync(await fcsv.path(), "utf8");
  check("19e and its export has no column for the hidden Service",
    !/Shore power 30A/.test(text.split("\n")[0]) && /Water/.test(text.split("\n")[0]), text.split("\n")[0].slice(0, 160));
} else {
  check("19e and its export has no column for the hidden Service", false, "no CSV downloaded");
}
await fp.screenshot({ path: `${OUT}/report-filtered.png`, fullPage: false });
await fpub.close();

// 14 · the in-app report is the audit itself
await page.goto(`${APP_URL}/audits/${auditId}/report`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="report-summary"]', { timeout: 60000 });
await page.waitForTimeout(1500);
check("19f the in-app report still shows everything", /Shore power 30A/.test(await page.locator("body").innerText()));

// ── 20: a Location that has since been removed (docs/audits.md § 6) ──────
// Tests 6 and 7 of the list approved 2026-09-24.
const goneName = sql(`select t.location_name from audit_targets t
     join audit_findings f on f.target_id = t.id
    where t.audit_id = '${auditId}' order by t.position limit 1`);
sql(`update locations set retired_at = now()
      where id = (select location_id from audit_targets
                   where audit_id = '${auditId}' and location_name = '${goneName}')`);
// A fresh link: the one at the top of this file was revoked by 18b.
// Wrapped in a SELECT: psql prints "INSERT 0 1" after a bare INSERT, and
// sql() hands back everything it printed.
const goneKey = sql(`with s as (insert into audit_shares (audit_id, label)
     values ('${auditId}', 'e2e removed ${stamp}') returning key) select key from s`);
const gp = await pub.context().newPage();
await gp.goto(`${APP_URL}/r/${goneKey}`, { waitUntil: "domcontentloaded" });
await gp.waitForSelector('[data-testid="report-locations"]', { timeout: 60000 });
await gp.waitForTimeout(2000);
const goneRow = gp.locator('[data-testid="report-row-gone"]');
check("20a the removed location's row is struck through", (await goneRow.count()) === 1, `${await goneRow.count()} struck of ${await gp.locator('[data-testid="report-locations"] tbody tr').count()} rows`);
check("20b and it is the right one, saying so in its notes",
  /^removed/.test((await goneRow.locator("td.report-notes").innerText()).trim()) &&
    (await goneRow.locator("td").first().innerText()).includes(goneName),
  `${goneName}: ${(await goneRow.locator("td.report-notes").innerText()).trim().slice(0, 60)}`);
check("20c the summary says it in prose too",
  /location has since been removed/.test(await gp.locator('[data-testid="report-summary"]').innerText()));

// A spreadsheet has no strikethrough, so the words have to be in the file.
const gdl = [];
gp.on("download", (d) => gdl.push(d));
await gp.getByTestId("report-export").click();
await gp.getByLabel("Rows").selectOption("locations");
await gp.getByTestId("report-export-run").click();
await gp.waitForTimeout(2500);
const gcsv = gdl.find((d) => d.suggestedFilename().endsWith("locations.csv"));
if (gcsv) {
  const line = readFileSync(await gcsv.path(), "utf8").split("\n").find((l) => l.startsWith(goneName) || l.startsWith(`"${goneName}`));
  check("20d and the export carries it, where there is no styling to carry", /removed/.test(line ?? ""), (line ?? "no row").slice(0, 120));
} else {
  check("20d and the export carries it, where there is no styling to carry", false, "no CSV downloaded");
}
// Put it back: this database is shared with the other suites, and one of
// them clicks BH14-01L by name. A retired Location is filtered out of the
// pickers, so leaving it retired breaks them an hour later, somewhere else.
sql(`update locations set retired_at = null
      where id = (select location_id from audit_targets
                   where audit_id = '${auditId}' and location_name = '${goneName}')`);
await gp.close();

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (errors.length) console.log("--- errors ---\n" + errors.join("\n"));
process.exit(failed.length || errors.length ? 1 : 0);
