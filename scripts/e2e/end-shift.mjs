// End-to-end drive of the End Shift Item and the end of a shift
// (src/pages/checklists/ActiveChecklistPage.spec.md § End Shift Item and
// § Ending the shift; src/pages/home/DashboardPage.spec.md § The Shift card;
// src/pages/admin/AdminChecklistTemplatesPage.spec.md § End Shift Items),
// tests 9–15 of the approved list. Run against the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   psql "$DB" -f scripts/e2e/seed-end-shift.sql
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/end-shift.mjs
//
// It starts and ends shifts for the test account and rewrites the e2e
// templates; each scenario resets them through e2e_end_shift_reset().
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

if (sql(`select count(*) from pg_proc where proname = 'e2e_end_shift_reset'`) !== "1") {
  console.error("Seed first: psql -f scripts/e2e/seed-end-shift.sql");
  process.exit(2);
}

/** Poll Postgres until the device's writes have uploaded. */
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

const instanceOf = (template) =>
  sql(`select i.id from checklist_instances i join checklist_templates t on t.id = i.template_id
        where t.name = '${template}' order by i.created_at desc limit 1`);
const statusOf = (id) => `select status from checklist_instances where id = '${id}'`;
const activeShift = `select count(*) from shifts where guard_id = ${ME} and ended_at is null`;

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "/tmp/pw-test/state.json", viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" || m.text().includes("Discarding")) errors.push("console: " + m.text().slice(0, 200));
});
page.on("response", async (r) => {
  if (r.status() >= 400 && !r.url().includes("clerk")) errors.push(`${r.status()} ${r.url().slice(0, 100)} ${(await r.text().catch(() => "")).slice(0, 160)}`);
});

const shiftButton = () => page.getByTestId("shift-card-next");
const endShiftItem = () => page.getByTestId("end-shift-item");

async function reset(clockOut, onShift, spare) {
  sql(`select e2e_end_shift_reset(${clockOut}, ${onShift}, ${spare})`);
  // Let the device receive the reset before anything reads it.
  await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
}

// ---- Scenario A: Clock Out template due, a spare checklist open (9, 10, 11, 13)
await reset(true, true, true);
const evening = instanceOf("Evening Lockup e2e");

// 9
await shiftButton().filter({ hasText: "Finish Evening Lockup e2e" }).waitFor({ timeout: 120000 }).catch(() => {});
const label9 = (await shiftButton().textContent().catch(() => "")) ?? "";
await shiftButton().click().catch(() => {});
await page.waitForURL(`**/checklists/${evening}**`, { timeout: 15000 }).catch(() => {});
await endShiftItem().waitFor({ timeout: 30000 }).catch(() => {}); await page.waitForTimeout(500);
const inView = await endShiftItem().isVisible().catch(() => false)
  && (await endShiftItem().evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).catch(() => false));
check("9. the Shift card names the open checklist and opens it at its End Shift Item",
  label9.includes("Finish Evening Lockup e2e") && page.url().includes(evening) && inView,
  `label ${JSON.stringify(label9)}, url ${page.url()}, item in view ${inView}`);
await page.screenshot({ path: `${OUT}/end-shift-9.png` });

// 10
await endShiftItem().getByRole("button", { name: /End Shift/ }).click();
const confirm = endShiftItem().getByRole("button", { name: /Submit anyway/ });
const confirmText = (await confirm.textContent({ timeout: 5000 }).catch(() => "")) ?? "";
await confirm.click().catch(() => {});
const submitted = await until("the evening checklist to complete", statusOf(evening), "complete");
const closing = await (async () => {
  await until("an End of Shift Checklist to be linked",
    `select count(*) from shifts where guard_id = ${ME} and ended_at is null and end_of_shift_checklist_id is not null`, "1");
  return sql(`select s.end_of_shift_checklist_id from shifts s where s.guard_id = ${ME} and s.ended_at is null`);
})();
const closingName = closing ? sql(`select t.name from checklist_instances i join checklist_templates t on t.id = i.template_id where i.id = '${closing}'`) : "";
await page.waitForURL(`**/checklists/${closing}**`, { timeout: 15000 }).catch(() => {});
check("10. End Shift asks before submitting with work left, submits its checklist, and opens the linked End of Shift Checklist",
  /Submit anyway.*1 unanswered/.test(confirmText) && submitted && closingName === "Closing e2e" && page.url().includes(closing),
  `confirm ${JSON.stringify(confirmText)}, submitted ${submitted}, linked ${JSON.stringify(closingName)}, url ${page.url()}`);
await page.screenshot({ path: `${OUT}/end-shift-10.png` });

// 11, part one
await page.getByRole("button", { name: /Mark complete/ }).first().click();
await page.getByRole("button", { name: /^Submit Checklist$/ }).click();
await page.waitForURL("**/shift/end", { timeout: 15000 }).catch(() => {});
const closingDone = await until("the closing checklist to complete", statusOf(closing), "complete");
await page.waitForTimeout(3000);
const stillOn = sql(activeShift) === "1";

// 13
const openList = page.getByTestId("end-of-shift-open");
const openText = (await openList.textContent({ timeout: 10000 }).catch(() => "")) ?? "";
const spareLink = await openList.getByRole("link", { name: /Spare e2e/ }).count().catch(() => 0);
check("13. the review lists a still-open checklist from this shift, with the warning and a link to finish it",
  /Spare e2e/.test(openText) && /won.t be saved/.test(openText) && spareLink === 1 && !/Evening Lockup e2e/.test(openText),
  JSON.stringify(openText.slice(0, 200)));
await page.screenshot({ path: `${OUT}/end-shift-13.png`, fullPage: true });

// 11, part two
await page.getByRole("button", { name: "End Shift and Submit" }).click();
const ended = await until("the shift to end", activeShift, "0");
await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" });
const startShown = await page.getByRole("button", { name: "Start Shift" }).waitFor({ timeout: 20000 }).then(() => true, () => false);
check("11. submitting the End of Shift Checklist leaves the shift open on the review; End Shift and Submit ends it",
  page.url() && closingDone && stillOn && ended && startShown,
  `closing complete ${closingDone}, still on shift after it ${stillOn}, ended after the button ${ended}, Start Shift shown ${startShown}`);

// ---- Scenario B: no End of Shift Checklist due (12)
await reset(false, true, false);
const evening2 = instanceOf("Evening Lockup e2e");
await page.goto(`${APP_URL}/checklists/${evening2}`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /Mark complete/ }).first().click({ timeout: 120000 });
await endShiftItem().getByRole("button", { name: /End Shift/ }).click();
await page.waitForURL("**/shift/end", { timeout: 15000 }).catch(() => {});
const submitted2 = await until("the evening checklist to complete", statusOf(evening2), "complete");
check("12. with no End of Shift Checklist due, End Shift goes straight to the review",
  page.url().endsWith("/shift/end") && submitted2 && sql(activeShift) === "1",
  `url ${page.url()}, submitted ${submitted2}`);
await page.screenshot({ path: `${OUT}/end-shift-12.png` });

// ---- Scenario C: not on shift (14)
await reset(true, false, false);
const evening3 = instanceOf("Evening Lockup e2e");
await page.goto(`${APP_URL}/checklists/${evening3}`, { waitUntil: "domcontentloaded" });
await endShiftItem().waitFor({ timeout: 120000 });
const itemText = (await endShiftItem().textContent()) ?? "";
const buttons = await endShiftItem().getByRole("button").count();
await endShiftItem().click().catch(() => {});
await page.waitForTimeout(1500);
const submitText = (await page.getByRole("button", { name: /Submit Checklist/ }).textContent().catch(() => "")) ?? "";
check("14. off shift, the item says so, does nothing, and counts as unanswered",
  /not on shift/.test(itemText) && buttons === 0 && /2 items remaining/.test(submitText)
    && sql(statusOf(evening3)) === "in_progress" && sql(activeShift) === "0",
  `item ${JSON.stringify(itemText)}, buttons ${buttons}, submit ${JSON.stringify(submitText)}`);
await page.screenshot({ path: `${OUT}/end-shift-14.png` });

// ---- Template editor (15)
async function openTemplate(name) {
  await page.goto(`${APP_URL}/admin/checklist-templates`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name, exact: true }).click({ timeout: 120000 });
  const card = page.locator(".card", { has: page.locator(`input[aria-label="Template name"][value="${name}"]`) });
  await card.waitFor();
  await card.getByRole("button", { name: /^Editor section \| / }).click();
  return card;
}
let card = await openTemplate("Editor e2e");
const addMenu = () => card.locator("select", { has: page.locator('option[value=""]', { hasText: "Add an item" }) });
await addMenu().selectOption("end_shift");
const itemsInOrder = async () =>
  sql(`select string_agg(ti.type::text, ',' order by ti.position)
         from checklist_template_items ti join checklist_template_sections s on s.id = ti.section_id
         join checklist_templates t on t.id = s.template_id where t.name = 'Editor e2e'`);
await until("the End Shift item to upload", `select count(*) from checklist_template_items ti
  join checklist_template_sections s on s.id = ti.section_id join checklist_templates t on t.id = s.template_id
  where t.name = 'Editor e2e' and ti.type = 'end_shift'`, "1");
await addMenu().selectOption("simple_check");
await until("the second item to upload", `select count(*) from checklist_template_items ti
  join checklist_template_sections s on s.id = ti.section_id join checklist_templates t on t.id = s.template_id
  where t.name = 'Editor e2e'`, "3");
await page.waitForTimeout(1500);
const order = await itemsInOrder();
const offeredAgain = await addMenu().locator('option[value="end_shift"]').count();
await card.getByRole("button", { name: "Expand settings" }).click();
const clockOutOption = card.locator('option[value="clock_out"]');
const clockOutDisabled = await clockOutOption.evaluate((o) => o.disabled).catch(() => null);
await page.screenshot({ path: `${OUT}/end-shift-15a.png`, fullPage: true });
card = await openTemplate("Editor clock out e2e");
const offeredOnClockOut = await addMenu().locator('option[value="end_shift"]').count();
check("15. the editor adds End Shift last and keeps it there, then stops offering it and blocks Clock Out; a Clock Out template never offers it",
  order === "simple_check,simple_check,end_shift" && offeredAgain === 0 && clockOutDisabled === true && offeredOnClockOut === 0,
  `order ${order}, offered again ${offeredAgain}, Clock Out disabled ${clockOutDisabled}, offered on Clock Out ${offeredOnClockOut}`);

await browser.close();
if (errors.length) {
  console.log("\nErrors seen:");
  for (const e of errors) console.log("  " + e);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
