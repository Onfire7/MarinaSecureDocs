// End-to-end drive of the Shift Report (src/pages/reports/
// ShiftReportPage.spec.md), tests 11-14 of the approved list (2026-10-21).
// Run against the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   psql "$DB" -f scripts/e2e/seed-shift-report.sql
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/shift-report.mjs
//
// It ends the test account's shift; each scenario resets through
// e2e_shift_report_reset().
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OUT = "/tmp/pw-test/screenshots";
const sql = (q) => execSync(`psql "${DB}" -Atc ${JSON.stringify(q.replace(/\s+/g, " "))}`).toString().trim();
const ME = `(select id from users where email = 'gpp@onfire.us')`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok " : "NOT ok"} ${name}${detail ? " — " + detail : ""}`);
};
if (sql(`select count(*) from pg_proc where proname = 'e2e_shift_report_reset'`) !== "1") {
  console.error("Seed first: psql -f scripts/e2e/seed-shift-report.sql");
  process.exit(2);
}
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
const activeShift = () => sql(`select id from shifts where guard_id = ${ME} and ended_at is null order by started_at desc limit 1`);

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "/tmp/pw-test/state.json", viewport: { width: 1280, height: 900 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" || m.text().includes("Discarding")) errors.push("console: " + m.text().slice(0, 200));
});
page.on("response", async (r) => {
  if (r.status() >= 400 && !r.url().includes("clerk")) errors.push(`${r.status()} ${r.url().slice(0, 100)} ${(await r.text().catch(() => "")).slice(0, 160)}`);
});

async function reset(fresh) {
  sql(`select e2e_shift_report_reset(${fresh})`);
  await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
}

// ---- 11. The review, then End Shift and Submit
await reset(false);
const shiftId = activeShift();
await page.goto(`${APP_URL}/shift/end`, { waitUntil: "domcontentloaded" });
await page.getByTestId("shift-report").waitFor({ timeout: 120000 });
await page.waitForTimeout(2000);
const attention11 = (await page.getByTestId("report-attention").textContent().catch(() => "")) ?? "";
const banner11 = await page.getByTestId("report-banner").count();
const noteBox = page.getByLabel("End of Shift Note");
await noteBox.fill("Quiet night apart from the gate post.");
await page.screenshot({ path: `${OUT}/shift-report-11-review.png`, fullPage: true });
await page.getByRole("button", { name: "End Shift and Submit" }).click();
const dialog = page.getByTestId("email-dialog");
await dialog.waitFor({ timeout: 20000 });
const subject = await dialog.getByTestId("email-subject").inputValue();
const body = await dialog.getByTestId("email-body").inputValue();
const link = await dialog.getByTestId("email-link").inputValue();
const ended = await until("the shift to end", `select ended_at is not null from shifts where id = '${shiftId}'`, "t");
const snapshotStored = await until("the snapshot to upload", `select count(*) from shift_report_snapshots where shift_id = '${shiftId}'`, "1");
await page.screenshot({ path: `${OUT}/shift-report-11-dialog.png` });
check("11. the review shows the live report with its banner and the unlocked door, never a missed checkpoint; End Shift and Submit stores the snapshot, ends the shift and opens the email",
  banner11 === 1 && !/Report CP B e2e/.test(attention11) && /Report door e2e found Unlocked/.test(attention11)
    && /^Shift report: /.test(subject) && /Quiet night apart from the gate post/.test(body) && link.endsWith(`/r/shift/${shiftId}`)
    && ended && snapshotStored,
  `banner ${banner11}, attention ${JSON.stringify(attention11.slice(0, 200))}, subject ${JSON.stringify(subject)}, link ${link}, ended ${ended}, snapshot ${snapshotStored}`);
await dialog.getByRole("button", { name: "Done" }).click();

// ---- 12. The public page, signed out
const pub = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const ppage = await pub.newPage();
const requests = [];
ppage.on("request", (r) => requests.push(r.url()));
await ppage.goto(`${APP_URL}/r/shift/${shiftId}`, { waitUntil: "networkidle" });
await ppage.getByTestId("shift-report").waitFor({ timeout: 30000 });
const pubText = (await ppage.getByTestId("shift-report").textContent()) ?? "";
const forbidden = requests.filter((u) => /clerk|powersync/i.test(u));
const incidentId = sql(`select id from incidents where title = 'Report incident e2e'`);
sql(`insert into incident_comments (incident_id, body, created_at, author_id) values ('${incidentId}', 'Owner reminded of the policy.', now(), ${ME})`);
await ppage.reload({ waitUntil: "networkidle" });
await ppage.getByTestId("shift-report").waitFor({ timeout: 30000 });
const sinceText = (await ppage.getByTestId("report-since").first().textContent()) ?? "";
const noteStill = await ppage.getByTestId("report-note").textContent().catch(() => "");
await ppage.screenshot({ path: `${OUT}/shift-report-12-public.png`, fullPage: true });
await ppage.goto(`${APP_URL}/r/shift/00000000-0000-4000-8000-000000000000`, { waitUntil: "networkidle" });
const gone = await ppage.getByTestId("report-gone").count();
check("12. the public page renders the snapshot without Clerk or PowerSync, shows a later addendum beneath the incident with the body unchanged, and one neutral page for an unknown id",
  /Quiet night apart from the gate post/.test(pubText) && /Report incident e2e/.test(pubText) && forbidden.length === 0
    && /Owner reminded of the policy/.test(sinceText) && /Quiet night apart from the gate post/.test(noteStill ?? "") && gone === 1,
  `forbidden ${JSON.stringify(forbidden)}, since ${JSON.stringify(sinceText.slice(0, 120))}, gone ${gone}`);
await pub.close();

// ---- 13. The in-app page and Email report
await page.goto(`${APP_URL}/reports/shifts/${shiftId}`, { waitUntil: "domcontentloaded" });
await page.getByTestId("shift-report").waitFor({ timeout: 120000 });
await page.waitForTimeout(2000);
const incidentLink = await page.locator(`#incident-${incidentId} a[href="/incidents/${incidentId}"]`).count();
await page.getByRole("button", { name: "Email report" }).click();
await page.getByTestId("email-dialog").waitFor();
await page.getByRole("button", { name: "Copy all" }).click();
await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
await page.screenshot({ path: `${OUT}/shift-report-13-in-app.png`, fullPage: true });
check("13. the in-app page shows the same document with the incident linked, and Copy all puts subject, body and link on the clipboard",
  incidentLink === 1 && /^Shift report: /.test(clip) && /Quiet night apart from the gate post/.test(clip) && clip.includes(`/r/shift/${shiftId}`),
  `link ${incidentLink}, clipboard ${JSON.stringify(clip.slice(0, 80))}`);
await page.getByRole("button", { name: "Done" }).click();

// ---- 14. Before End of Shift
await reset(true);
const fresh = activeShift();
await page.goto(`${APP_URL}/reports/shifts/${fresh}`, { waitUntil: "domcontentloaded" });
await page.getByTestId("shift-report").waitFor({ timeout: 120000 });
const banner14 = (await page.getByTestId("report-banner").textContent().catch(() => "")) ?? "";
const pub2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const p2 = await pub2.newPage();
await p2.goto(`${APP_URL}/r/shift/${fresh}`, { waitUntil: "networkidle" });
const notEnded = (await p2.getByTestId("report-not-ended").textContent().catch(() => "")) ?? "";
await p2.screenshot({ path: `${OUT}/shift-report-14-public.png` });
await pub2.close();
check("14. before End of Shift the in-app page is live with its banner, and the public page says the shift hasn't ended",
  /hasn't ended yet/.test(banner14) && /hasn't ended yet/.test(notEnded),
  `in-app ${JSON.stringify(banner14)}, public ${JSON.stringify(notEnded.slice(0, 120))}`);

await browser.close();
if (errors.length) {
  console.log("\nErrors seen:");
  for (const e of errors) console.log("  " + e);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
