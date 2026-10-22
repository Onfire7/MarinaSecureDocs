// End-to-end drive of clock-in creating every Clock In checklist
// (DashboardPage.spec.md § The Shift card) and of the Start picker's
// triggered group (ChecklistListPage.spec.md § Starting a checklist by hand),
// tests 8 and 9 of the approved list. Run against the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   psql "$DB" -f scripts/e2e/seed-checklist-start.sql
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/checklist-start.mjs
//
// It starts a shift and creates checklists. Re-seed before each run.
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OUT = "/tmp/pw-test/screenshots";
const sql = (q) => execSync(`psql "${DB}" -Atc ${JSON.stringify(q.replace(/\s+/g, " "))}`).toString().trim();

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok " : "NOT ok"} ${name}${detail ? " — " + detail : ""}`);
};

const me = sql(`select id from users where email = 'gpp@onfire.us'`);
const tplA = sql(`select id from checklist_templates where name = 'Clock In A e2e'`);
const tplB = sql(`select id from checklist_templates where name = 'Clock In B e2e'`);
if (!tplA || !tplB || sql(`select count(*) from shifts where guard_id = '${me}' and ended_at is null`) !== "0") {
  console.error("Seed first: psql -f scripts/e2e/seed-checklist-start.sql");
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

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "/tmp/pw-test/state.json", viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });

const instancesOf = (tpl) =>
  sql(`select count(*) from checklist_instances where template_id = '${tpl}' and assigned_to_id = '${me}'`);
const picker = () => page.getByRole("combobox", { name: "Start a checklist…" });
const triggeredOptions = async () =>
  page.locator('optgroup[label="Triggered"] option').allInnerTexts().catch(() => []);

// ── 8: Start Shift creates both Clock In checklists, lands on /checklists ──
{
  await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Start Shift" }).click({ timeout: 120000 });
  await page.waitForURL(/\/checklists$/, { timeout: 30000 });
  await page.getByText("Clock In A e2e").first().waitFor();
  await page.getByText("Clock In B e2e").first().waitFor();
  const a = await until("instance A", `select count(*) from checklist_instances where template_id = '${tplA}'`, "1");
  const b = await until("instance B", `select count(*) from checklist_instances where template_id = '${tplB}'`, "1");
  const sameMinute = sql(`select count(*) from checklist_instances i join shifts s on s.guard_id = '${me}' and s.ended_at is null
                           where i.template_id in ('${tplA}','${tplB}') and i.created_at between s.started_at - interval '1 minute' and s.started_at + interval '1 minute'`);
  await page.screenshot({ path: `${OUT}/e2e-08-both-created.png` });
  check("8 Start Shift creates both Clock In checklists and lands on the Checklists page",
    a && b && sameMinute === "2", `a=${a} b=${b} sameMinute=${sameMinute} url=${page.url()}`);
}

// ── 9: the picker offers a triggered template only while no open instance is mine ──
{
  const before = await triggeredOptions();
  // Complete A, so it becomes offerable again.
  sql(`update checklist_instances set status = 'complete', completed_at = now() where template_id = '${tplA}'`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await picker().waitFor({ timeout: 60000 });
  const end = Date.now() + 30000;
  let after = [];
  while (Date.now() < end && !after.some((o) => o.startsWith("Clock In A e2e"))) {
    after = await triggeredOptions();
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `${OUT}/e2e-09-picker.png` });
  await picker().selectOption({ value: tplA });
  await page.getByRole("button", { name: "Start checklist" }).click();
  await page.waitForURL(/\/checklists\/[0-9a-f-]+$/, { timeout: 30000 });
  const two = await until("the second A instance", instancesOf(tplA) === "2" ? "select 2" : `select count(*) from checklist_instances where template_id = '${tplA}'`, "2");
  await page.goto(`${APP_URL}/checklists`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const gone = !(await triggeredOptions()).some((o) => o.startsWith("Clock In A e2e"));
  check("9 a triggered template is offered only while it has no open instance of mine, with its trigger label",
    !before.some((o) => o.includes("e2e")) && after.includes("Clock In A e2e · Clock In") && !after.some((o) => o.startsWith("Clock In B e2e")) && two && gone,
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)} two=${two} gone=${gone}`);
}

await browser.close();
if (errors.length) console.log("errors:\n  " + errors.join("\n  "));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
