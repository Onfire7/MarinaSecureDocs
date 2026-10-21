// End-to-end drive of the Fleet Vehicle Item, the End of Shift vehicle step,
// the Shift Report's Vehicles section and Asset triggers
// (src/pages/checklists/ActiveChecklistPage.spec.md § Fleet Vehicle Item),
// tests 14–22 of the approved list. Run against the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   psql "$DB" -c 'select refresh_sync_scopes_all()'
//   psql "$DB" -f scripts/e2e/seed-fleet-card.sql
//   psql "$DB" -f scripts/e2e/seed-fleet-checklist.sql
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/fleet-checklist.mjs
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OUT = "/tmp/pw-test/screenshots";
const sql = (q) => execSync(`psql "${DB}" -Atc ${JSON.stringify(q.replace(/\s+/g, " "))}`).toString().trim();
const ME = `(select id from users where email = 'gpp@onfire.us')`;
const MY_CONTACT = `(select contact_id from users where email = 'gpp@onfire.us')`;
const asset = (name) => `(select id from assets where name = '${name}')`;
const PATROL = `(select i.id from checklist_instances i join checklist_templates t on t.id = i.template_id
                  where t.name = 'Fleet Patrol e2e' order by i.created_at limit 1)`;
const itemResult = (label) =>
  `select coalesce(ii.result::text, '') from checklist_instance_items ii
     join checklist_template_items ti on ti.id = ii.template_item_id
     join checklist_instance_sections s on s.id = ii.section_id
    where s.instance_id = ${PATROL} and ti.label = '${label}'`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok " : "NOT ok"} ${name}${detail ? " — " + detail : ""}`);
};

if (sql(`select count(*) from pg_proc where proname = 'e2e_fleet_item_reset'`) !== "1") {
  console.error("Seed first: psql -f scripts/e2e/seed-fleet-card.sql -f scripts/e2e/seed-fleet-checklist.sql");
  process.exit(2);
}

/** Poll Postgres until the device's writes have uploaded. */
async function until(what, query, expected, timeout = 30000) {
  const end = Date.now() + timeout;
  let got;
  while (Date.now() < end) {
    got = sql(query);
    if (typeof expected === "function" ? expected(got) : got === expected) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`   (timed out waiting for ${what}: got ${JSON.stringify(got)})`);
  return false;
}

const browser = await chromium.launch();
const errors = [];

async function open() {
  const context = await browser.newContext({
    storageState: "/tmp/pw-test/state.json",
    viewport: { width: 430, height: 932 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.text().includes("Discarding")) errors.push("console: " + m.text().slice(0, 200));
  });
  page.on("response", async (r) => {
    if (r.status() >= 400 && !r.url().includes("clerk")) errors.push(`${r.status()} ${r.url().slice(0, 100)} ${(await r.text().catch(() => "")).slice(0, 160)}`);
  });
  return page;
}

const page = await open();
const item = (mode) => page.locator(`[data-testid="fleet-item"][data-mode="${mode}"]`);
const itemTile = (mode, name) => item(mode).locator(`[data-testid="fleet-item-tile"][data-vehicle="${name}"]`);

async function reset(holding) {
  sql(`select e2e_fleet_item_reset(${holding})`);
  await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
}

async function openPatrol(query = "") {
  const id = sql(PATROL);
  await page.goto(`${APP_URL}/checklists/${id}${query}`, { waitUntil: "domcontentloaded" });
  await item("take").waitFor({ timeout: 60000 });
}

async function takeTruck() {
  await itemTile("take", "Truck e2e").getByRole("button", { name: /Truck e2e/ }).first().click();
  await item("take").getByRole("button", { name: "Check out Truck e2e" }).click();
  return until("the checkout to upload",
    `select count(*) from asset_checkouts where asset_id = ${asset("Truck e2e")} and time_in is null and person_id = ${MY_CONTACT}`, "1");
}

// ---- 14. Take from the item
await reset(false);
await openPatrol();
const pickable = async (name) => itemTile("take", name).getAttribute("data-pickable");
const states = {
  truck: await pickable("Truck e2e"),
  van: await pickable("Van e2e"),
  cart: await pickable("Cart e2e"),
  mine: await pickable("Mine e2e"),
};
const truckTileText = await itemTile("take", "Truck e2e").innerText();
const vanTileText = await itemTile("take", "Van e2e").innerText();
await page.screenshot({ path: `${OUT}/fleet-item-14a.png`, fullPage: true });
const took = await takeTruck();
const takeSaved = await until("the Take result", itemResult("Take a vehicle"), (r) => r.includes('"checkoutId"'));
await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" });
const cardGroup = await page
  .locator(`[data-testid="fleet-tile"][data-vehicle="Truck e2e"]`)
  .getAttribute("data-group", { timeout: 30000 })
  .catch(() => "");
check("14. the board shows each vehicle's state; only available ones are tappable; checking out answers the item and the card shows it as yours",
  states.truck === "true" && states.mine === "true" && states.van === "false" && states.cart === "false" &&
    /Available/.test(truckTileText) && /1,000/.test(truckTileText) && /With Dana e2e/.test(vanTileText) &&
    took && takeSaved && cardGroup === "yours",
  `pickable ${JSON.stringify(states)}, card group ${cardGroup}`);
await page.screenshot({ path: `${OUT}/fleet-item-14b.png`, fullPage: true });

// ---- 15. answered by circumstance, and No vehicle this shift
await reset(true);
await openPatrol();
const takeText = (await item("take").innerText()).replace(/\s+/g, " ");
const circumstance = /Mine e2e · checked out/.test(takeText);
await reset(false);
await openPatrol();
await item("take").getByRole("button", { name: "No vehicle this shift" }).click();
const none = await until("No vehicle this shift", itemResult("Take a vehicle"), (r) => r.includes('"none":true'));
check("15. a vehicle already in hand answers Take; No vehicle this shift answers it too",
  circumstance && none, `take text ${JSON.stringify(takeText.slice(0, 120))}`);

// ---- 16. Status Check writes at once, and Edit withdraws it
await reset(true);
await openPatrol();
const status = item("status");
await status.getByLabel(/Odometer/).fill("2040");
await status.getByRole("button", { name: /Add fuel/ }).click();
await status.getByLabel("Gallons").fill("9.5");
await status.getByRole("button", { name: "Record" }).click();
const fuelRow = await until("the fuel row",
  `select count(*) from asset_fuel_logs where asset_id = ${asset("Mine e2e")} and gallons = 9.5 and level = 4`, "1");
await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" });
const gauge = await page
  .locator(`[data-testid="fleet-tile"][data-vehicle="Mine e2e"] [data-testid="fuel-gauge"]`)
  .getAttribute("data-level", { timeout: 30000 })
  .catch(() => "");
await openPatrol();
await item("status").getByRole("button", { name: "Edit" }).click();
const withdrawn = await until("the withdrawal",
  `select count(*) from asset_fuel_logs where asset_id = ${asset("Mine e2e")}`, "0");
const refilled = (await item("status").getByLabel(/Odometer/).inputValue()) === "2040" &&
  (await item("status").getByLabel("Gallons").inputValue()) === "9.5";
await item("status").getByRole("button", { name: "Record" }).click();
const once = await until("the re-record",
  `select count(*) from asset_fuel_logs where asset_id = ${asset("Mine e2e")}`, "1");
check("16. a Status Check is written as it is recorded, Edit withdraws it and reopens it filled in, and re-recording writes once",
  fuelRow && gauge === "4" && withdrawn && refilled && once, `gauge ${gauge}, refilled ${refilled}`);
await page.screenshot({ path: `${OUT}/fleet-item-16.png`, fullPage: true });

// ---- 17. undo
await reset(false);
await openPatrol();
await takeTruck();
const walkaround = await until("the triggered section",
  `select count(*) from checklist_instance_sections where instance_id = ${PATROL} and label = 'Walkaround e2e'`, "1");
await item("take").getByRole("button", { name: "Edit" }).click();
await item("take").getByRole("button", { name: "Undo checkout of Truck e2e" }).click();
const undoneOut = await until("the undone checkout",
  `select count(*) from asset_checkouts where asset_id = ${asset("Truck e2e")}`, "0");
const sectionGone = await until("the triggered section to go",
  `select count(*) from checklist_instance_sections where instance_id = ${PATROL} and label = 'Walkaround e2e'`, "0");
const reopened = (await item("take").getByRole("button", { name: "No vehicle this shift" }).count()) === 1;

await takeTruck();
const ret = item("return");
await ret.getByLabel(/Odometer/).fill("1012");
await ret.getByRole("button", { name: "½", exact: true }).click();
await ret.getByRole("button", { name: "Check in", exact: true }).click();
const checkedIn = await until("the check-in",
  `select count(*) from asset_checkouts where asset_id = ${asset("Truck e2e")} and time_in is not null`, "1");
await item("return").getByRole("button", { name: "Edit" }).click();
await item("return").getByRole("button", { name: "Undo check-in of Truck e2e" }).click();
const undoneIn = await until("the undone check-in",
  `select count(*) from asset_checkouts where asset_id = ${asset("Truck e2e")} and time_in is null and fuel_level_in is null`, "1");
check("17. Undo checkout deletes it and the section it triggered; Undo check-in reopens the checkout",
  walkaround && undoneOut && sectionGone && reopened && checkedIn && undoneIn,
  `walkaround ${walkaround}, undone ${undoneOut}, section gone ${sectionGone}, reopened ${reopened}, in ${checkedIn}, undone in ${undoneIn}`);

// ---- 18. asset triggers
// Truck e2e is out to the test account (17 left it so). Checking it in from
// the card fires "Vehicle Return e2e", which has no open checklist: one is
// created. Then Asset Detail checks it out to Dana e2e: the Patrol
// template's check-out section goes to Dana, who has no open Patrol
// checklist, and Patrol is not an Asset Check Out/In template, so nothing.
await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" });
const truckCard = page.locator(`[data-testid="fleet-tile"][data-vehicle="Truck e2e"]`);
await truckCard.getByRole("button", { name: "Check in", exact: true }).click();
await page.getByRole("dialog").getByRole("button", { name: "½", exact: true }).click();
await page.getByRole("dialog").getByRole("button", { name: "Check in", exact: true }).click();
const created = await until("the created checklist",
  `select count(*) from checklist_instances i join checklist_templates t on t.id = i.template_id
    where t.name = 'Vehicle Return e2e' and i.assigned_to_id = ${ME}`, "1");
const truckId = sql(`select id from assets where name = 'Truck e2e'`);
await page.goto(`${APP_URL}/assets/${truckId}`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /^Check out/ }).first().click();
await page.getByRole("dialog").getByLabel(/Person|Who/).selectOption({ label: "Dana e2e contact" }).catch(() =>
  page.getByRole("dialog").getByLabel(/Person|Who/).selectOption({ label: "Dana e2e" }));
await page.getByRole("dialog").getByRole("button", { name: /^Check out/ }).click();
const toDana = await until("Dana's checkout",
  `select count(*) from asset_checkouts where asset_id = ${asset("Truck e2e")} and time_in is null
     and person_id = (select contact_id from users where name = 'Dana e2e')`, "1");
const danaNothing = sql(`select count(*) from checklist_instances where assigned_to_id = (select id from users where name = 'Dana e2e')`) === "0";
sql(`update checklist_templates set trigger_type = 'asset' where name = 'Fleet Patrol e2e'`);
sql(`update asset_checkouts set time_in = now() where asset_id = ${asset("Truck e2e")} and time_in is null`);
await page.waitForTimeout(3000);
await page.reload({ waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /^Check out/ }).first().click();
await page.getByRole("dialog").getByLabel(/Person|Who/).selectOption({ label: "Dana e2e contact" }).catch(() =>
  page.getByRole("dialog").getByLabel(/Person|Who/).selectOption({ label: "Dana e2e" }));
await page.getByRole("dialog").getByRole("button", { name: /^Check out/ }).click();
const danaGets = await until("Dana's checklist",
  `select count(*) from checklist_instances i join checklist_templates t on t.id = i.template_id
    where t.name = 'Fleet Patrol e2e' and i.assigned_to_id = (select id from users where name = 'Dana e2e')`, "1");
check("18. a card check-in creates the Asset Check Out/In checklist; an Asset Detail checkout to someone else sends the work to them",
  created && toDana && danaNothing && danaGets, `created ${created}, to Dana ${toDana}, nothing first ${danaNothing}, then ${danaGets}`);

// ---- 19. vehicles still out at End of Shift
await reset(true);
await page.goto(`${APP_URL}/shift/end`, { waitUntil: "domcontentloaded" });
await page.getByText("Before you go").waitFor({ timeout: 60000 });
await page.getByRole("button", { name: "Keep it past my shift" }).click();
const keepButton = page.getByRole("button", { name: "Keep it and continue" });
await page.getByLabel(/Odometer/).fill("2050");
await page.getByRole("button", { name: "¼", exact: true }).click();
const disabledWithoutReason = await keepButton.isDisabled();
await page.getByLabel(/Why are you keeping it/).fill("Covering the 6 AM gate run");
await keepButton.click();
const pair = await until("the kept pair",
  `select count(*) from asset_checkouts a join asset_checkouts b
      on b.asset_id = a.asset_id and b.time_out = a.time_in and b.kept_after_shift
    where a.asset_id = ${asset("Mine e2e")} and a.return_note = 'Covering the 6 AM gate run'
      and a.odometer_in = 2050 and a.fuel_level_in = 1 and b.time_in is null and b.odometer_out = 2050`, "1");
const noStatus = sql(`select count(*) from asset_status_logs where asset_id = ${asset("Mine e2e")}
                        and timestamp > now() - interval '5 minutes'`) === "0";
const reviewKept = await page.getByText(/kept past End of Shift/).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
await page.screenshot({ path: `${OUT}/fleet-item-19.png`, fullPage: true });
await page.getByRole("button", { name: "End Shift and Submit" }).click();
const ended = await until("the shift to end",
  `select count(*) from shifts where guard_id = ${ME} and ended_at is null`, "0");
sql(`insert into shifts (guard_id, started_at) values (${ME}, now())`);
await openPatrol();
const nextTake = (await item("take").innerText()).replace(/\s+/g, " ");
check("19. Before you go asks; Keep it needs a reason and writes the closed and continued pair with no status entry; the review shows it kept; the next shift reads it as kept",
  disabledWithoutReason && pair && noStatus && reviewKept && ended && /Mine e2e/.test(nextTake),
  `reason gate ${disabledWithoutReason}, pair ${pair}, no status ${noStatus}, review ${reviewKept}, ended ${ended}`);

// ---- 20. the Shift Report page
const endedShift = sql(`select id from shifts where guard_id = ${ME} and ended_at is not null order by ended_at desc limit 1`);
await page.goto(`${APP_URL}/reports/shifts/${endedShift}`, { waitUntil: "domcontentloaded" });
const vehicles = page.getByTestId("shift-vehicles");
await vehicles.waitFor({ timeout: 30000 });
const reportText = (await vehicles.innerText()).replace(/\s+/g, " ");
check("20. the Shift Report lists the trip with its miles, fuel and the reason it was kept",
  /Mine e2e/.test(reportText) && /\+50 mi/.test(reportText) && /Kept: Covering the 6 AM gate run/.test(reportText),
  JSON.stringify(reportText.slice(0, 200)));
await page.screenshot({ path: `${OUT}/fleet-item-20.png`, fullPage: true });

// ---- 21. the template editor
await page.goto(`${APP_URL}/admin/checklist-templates`, { waitUntil: "domcontentloaded" });
await page.getByText("Fleet Editor e2e").first().click();
const editor = page.getByTestId("template-section").filter({ hasText: "Editor section" });
await editor.getByRole("button", { name: /Add item/ }).click();
await page.getByRole("menuitem", { name: "Fleet Vehicle" }).or(page.getByRole("button", { name: "Fleet Vehicle" })).first().click();
const added = await until("the new item",
  `select count(*) from checklist_template_items ti join checklist_template_sections s on s.id = ti.section_id
     join checklist_templates t on t.id = s.template_id
    where t.name = 'Fleet Editor e2e' and ti.type = 'fleet_vehicle'`, "1");
await page.getByRole("button", { name: "Status Check", exact: true }).click();
const statusLabel = await until("the Status Check label",
  `select ti.label || '|' || (ti.config->>'mode') from checklist_template_items ti
     join checklist_template_sections s on s.id = ti.section_id join checklist_templates t on t.id = s.template_id
    where t.name = 'Fleet Editor e2e' and ti.type = 'fleet_vehicle'`, "Vehicle status check|status");
await editor.getByLabel("Trigger").selectOption({ label: "Asset checked in" });
const sectionEvent = await until("the section event",
  `select s.trigger_type || '|' || (s.trigger_config->>'event') from checklist_template_sections s
     join checklist_templates t on t.id = s.template_id where t.name = 'Fleet Editor e2e'`, "asset|check_in");
check("21. the editor adds a Fleet Vehicle item, Status Check sets its label, and an Asset checked in section saves its event",
  added && statusLabel && sectionEvent);
await page.screenshot({ path: `${OUT}/fleet-item-21.png`, fullPage: true });

// ---- 22. copy in the catalog
await reset(true);
await openPatrol("?lng=keys");
const keysText = [
  await item("take").innerText(),
  await item("status").innerText(),
  await item("return").innerText(),
].join("\n");
const english = ["No vehicle this shift", "Add fuel", "Fuel level", "Check in", "With you", "Record"].filter((s) =>
  keysText.includes(s));
await page.goto(`${APP_URL}/shift/end?lng=keys`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
const endText = await page.locator("main").innerText().catch(() => "");
const endEnglish = ["Before you go", "Keep it past my shift", "Check it in"].filter((s) => endText.includes(s));
await page.goto(`${APP_URL}/?lng=`, { waitUntil: "domcontentloaded" });
check("22. in keys mode the item and the End of Shift step show keys, not English",
  english.length === 0 && endEnglish.length === 0 && /checklists:fleet\./.test(keysText),
  `English left: ${JSON.stringify([...english, ...endEnglish])}`);

console.log(errors.length ? `\nErrors:\n${errors.join("\n")}` : "\nNo page errors, console errors or failed requests.");
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
await browser.close();
process.exit(results.every((r) => r.ok) && errors.length === 0 ? 0 : 1);
