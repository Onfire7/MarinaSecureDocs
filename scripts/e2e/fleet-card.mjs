// End-to-end drive of the Dashboard's Fleet card
// (src/pages/home/FleetCard.spec.md), tests 12–22 of the approved list. Run
// against the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   psql "$DB" -c 'select refresh_sync_scopes_all()'
//   psql "$DB" -f scripts/e2e/seed-fleet-card.sql
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/fleet-card.mjs
//
// The test account is the only identity that can sign in, so "a user without
// use_fleet" is that account with use_fleet denied by e2e_fleet_reset().
import { chromium } from "playwright";
import { execSync } from "node:child_process";

const APP_URL = process.env.APP_URL ?? "http://localhost:5173";
const DB = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const OUT = "/tmp/pw-test/screenshots";
const sql = (q) => execSync(`psql "${DB}" -Atc ${JSON.stringify(q.replace(/\s+/g, " "))}`).toString().trim();
const ME = `(select id from users where email = 'gpp@onfire.us')`;
const MY_CONTACT = `(select contact_id from users where email = 'gpp@onfire.us')`;
const asset = (name) => `(select id from assets where name = '${name}')`;

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok " : "NOT ok"} ${name}${detail ? " — " + detail : ""}`);
};

if (sql(`select count(*) from pg_proc where proname = 'e2e_fleet_reset'`) !== "1") {
  console.error("Seed first: psql -f scripts/e2e/seed-fleet-card.sql");
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

const browser = await chromium.launch();
const errors = [];

async function open(options = {}) {
  const context = await browser.newContext({
    storageState: "/tmp/pw-test/state.json",
    viewport: { width: 430, height: 932 },
    ...options,
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

let page = await open();
const card = () => page.getByTestId("fleet-card");
const tile = (name) => page.locator(`[data-testid="fleet-tile"][data-vehicle="${name}"]`);
const dialog = () => page.getByRole("dialog");

async function reset(vehicles = true, deny = []) {
  sql(`select e2e_fleet_reset(${vehicles}, '{${deny.join(",")}}')`);
  // Let the device receive the reset before anything reads it.
  await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
}

/** Open a small tile's drawer and press one of its actions. */
async function drawer(name, action) {
  await tile(name).getByRole("button", { name: new RegExp(name) }).click();
  await tile(name).getByRole("button", { name: action, exact: true }).click();
}

// ---- 12. when the card shows
await reset(true, ["use_fleet"]);
await page.getByText("Clock", { exact: true }).first().waitFor({ timeout: 120000 }).catch(() => {});
const withoutPermission = await card().count();
await reset(false, []);
const withoutVehicles = await card().count();
await reset(true, []);
const shown = await card().waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
check("12. the card is hidden without use_fleet and with no Fleet Vehicles, and shown with both",
  withoutPermission === 0 && withoutVehicles === 0 && shown,
  `without use_fleet ${withoutPermission}, without vehicles ${withoutVehicles}, shown ${shown}`);
await page.screenshot({ path: `${OUT}/fleet-12.png`, fullPage: true });

// ---- 20. the person picker (before checking anything out)
await drawer("Truck e2e", "Check out");
const options = await dialog().getByLabel("Person").locator("option").allTextContents();
const selected = await dialog().getByLabel("Person").evaluate((el) => el.selectedOptions[0]?.textContent ?? "");
const myName = sql(`select name from users where email = 'gpp@onfire.us'`);
check("20. the picker lists users with a contact, defaults to you, and leaves out users without one",
  options.includes("Dana e2e") && !options.includes("No Contact e2e") && selected === myName,
  `options ${JSON.stringify(options)}, selected ${JSON.stringify(selected)}`);

// ---- 13. check out (odometer unchanged: no reading)
await dialog().getByRole("button", { name: "Check out", exact: true }).click();
const out = await until("the checkout to upload",
  `select count(*) from asset_checkouts where asset_id = ${asset("Truck e2e")} and time_in is null
     and person_id = ${MY_CONTACT} and odometer_out = 1000`, "1");
const wide = await tile("Truck e2e").getAttribute("data-group").catch(() => "");
const readings13 = sql(`select count(*) from asset_meter_readings where asset_id = ${asset("Truck e2e")}`);
check("13. Check out makes the tile wide and records the starting odometer and your contact, with no reading when unchanged",
  out && wide === "yours" && readings13 === "1",
  `uploaded ${out}, group ${wide}, readings ${readings13}`);
await page.screenshot({ path: `${OUT}/fleet-13.png`, fullPage: true });

// ---- 14. check in
await reset();
await tile("Mine e2e").getByRole("button", { name: "Check in", exact: true }).click();
await dialog().getByLabel("Odometer").fill("2040");
const tripText = (await dialog().getByTestId("fleet-trip").textContent().catch(() => "")) ?? "";
await dialog().getByRole("button", { name: "¼", exact: true }).click();
await dialog().getByLabel("Anything to report?").fill("Wipers squeak e2e");
await dialog().getByRole("button", { name: "Check in", exact: true }).click();
const closed = await until("the check-in to upload",
  `select count(*) from asset_checkouts where asset_id = ${asset("Mine e2e")} and time_in is not null
     and odometer_in = 2040 and fuel_level_in = 1 and return_note = 'Wipers squeak e2e'`, "1");
const returned = await until("the post-return status",
  `select st.name from asset_status_logs sl join asset_statuses st on st.id = sl.status_id
    where sl.asset_id = ${asset("Mine e2e")} order by sl.timestamp desc limit 1`, "Available");
const reading14 = sql(`select value from asset_meter_readings where asset_id = ${asset("Mine e2e")} order by timestamp desc limit 1`);
await page.waitForTimeout(1500);
const group14 = await tile("Mine e2e").getAttribute("data-group").catch(() => "");
const gauge14 = await tile("Mine e2e").getByTestId("fuel-gauge").getAttribute("data-level").catch(() => "");
check("14. Check in closes the checkout with odometer, fuel and note, logs the post-return status, and the tile returns to the grid",
  /\+40/.test(tripText) && closed && returned && reading14 === "2040" && group14 === "available" && gauge14 === "1",
  `trip ${JSON.stringify(tripText)}, closed ${closed}, status ${returned}, reading ${reading14}, group ${group14}, gauge ${gauge14}`);
await page.screenshot({ path: `${OUT}/fleet-14.png`, fullPage: true });

// ---- 15. fuel
await drawer("Truck e2e", "Fuel");
await dialog().getByLabel("Gallons").fill("12.5");
await dialog().getByLabel("Cost").fill("41.10");
await dialog().getByLabel("Odometer").fill("1020");
await dialog().getByRole("button", { name: "Save", exact: true }).click();
const fill = await until("the fill-up to upload",
  `select count(*) from asset_fuel_logs where asset_id = ${asset("Truck e2e")}
     and gallons = 12.5 and cost = 41.10 and odometer = 1020 and logged_by_id = ${ME}`, "1");
const reading15 = await until("the reading", `select max(value) from asset_meter_readings where asset_id = ${asset("Truck e2e")}`, "1020");
const gauge15 = await tile("Truck e2e").getByTestId("fuel-gauge").getAttribute("data-level").catch(() => "");
check("15. a fill-up writes its row and a reading, and the gauge reads full",
  fill && reading15 && gauge15 === "4", `fill ${fill}, reading ${reading15}, gauge ${gauge15}`);
await page.screenshot({ path: `${OUT}/fleet-15.png`, fullPage: true });

// ---- 16. lower mileage needs a correction reason
await reset();
await drawer("Truck e2e", "Mileage");
await dialog().getByLabel("Odometer").fill("990");
const blocked = await dialog().getByRole("button", { name: "Save", exact: true }).isDisabled();
await dialog().getByLabel("Reason").fill("Typo e2e");
await dialog().getByRole("button", { name: "Save", exact: true }).click();
const corrected = await until("the corrected reading",
  `select count(*) from asset_meter_readings where asset_id = ${asset("Truck e2e")} and value = 990 and correction_reason = 'Typo e2e'`, "1");
check("16. a lower odometer can't be saved until a reason is given, and is stored with it",
  blocked && corrected, `blocked ${blocked}, stored ${corrected}`);

// ---- 17. maintenance
await drawer("Truck e2e", "Mileage");
await dialog().getByLabel("Odometer").fill("1500");
await dialog().getByRole("button", { name: "Save", exact: true }).click();
const ticket = await until("the maintenance ticket",
  `select count(*) from tickets where asset_id = ${asset("Truck e2e")} and auto_generated
     and title = 'Maintenance due: Truck e2e — Oil change e2e'`, "1");
check("17. mileage that crosses a maintenance rule raises its ticket", ticket);

// ---- 18. someone else's vehicle, and out of service
await reset();
const vanText = (await tile("Van e2e").textContent().catch(() => "")) ?? "";
await tile("Van e2e").getByRole("button", { name: /Van e2e/ }).click();
const vanButtons = await tile("Van e2e").getByRole("button").allTextContents();
const cartDisabled = await tile("Cart e2e").getByRole("button", { name: /Cart e2e/ }).isDisabled().catch(() => false);
const cartButtons = await tile("Cart e2e").getByRole("button").count();
check("18. someone else's vehicle names its holder with no Check out or Check in; an out-of-service one is disabled",
  /With Dana e2e/.test(vanText) && vanButtons.some((b) => b === "Fuel") && !vanButtons.some((b) => /Check (in|out)/.test(b))
    && cartDisabled && cartButtons === 1,
  `van ${JSON.stringify(vanText.slice(0, 60))}, van buttons ${JSON.stringify(vanButtons)}, cart disabled ${cartDisabled}, cart buttons ${cartButtons}`);
await page.screenshot({ path: `${OUT}/fleet-18.png`, fullPage: true });

// ---- 19. incident and ticket
await tile("Mine e2e").getByRole("button", { name: "Incident", exact: true }).click();
await page.waitForURL("**/incidents/new", { timeout: 15000 }).catch(() => {});
const incidentTarget = (await page.getByText("Mine e2e").first().textContent({ timeout: 10000 }).catch(() => "")) ?? "";
await page.goto(`${APP_URL}/`, { waitUntil: "domcontentloaded" });
await tile("Mine e2e").getByRole("button", { name: "Ticket", exact: true }).click({ timeout: 60000 });
await page.waitForURL("**/tickets/new", { timeout: 15000 }).catch(() => {});
const ticketLocked = await page.getByRole("button", { name: "Change" }).isVisible({ timeout: 10000 }).catch(() => false);
const ticketTarget = (await page.getByText("Mine e2e").first().textContent().catch(() => "")) ?? "";
await reset(true, ["create_incidents"]);
await card().waitFor({ timeout: 60000 }).catch(() => {});
const incidentWithout = await tile("Mine e2e").getByRole("button", { name: "Incident", exact: true }).count();
check("19. Incident and Ticket open their forms with the vehicle locked; Incident is hidden without create_incidents",
  incidentTarget.includes("Mine e2e") && ticketLocked && ticketTarget.includes("Mine e2e") && incidentWithout === 0,
  `incident ${JSON.stringify(incidentTarget)}, ticket locked ${ticketLocked}, incident without permission ${incidentWithout}`);

// ---- 21. the fleet flag
await reset();
await page.goto(`${APP_URL}/assets`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: "+ Add asset" }).click({ timeout: 60000 });
const fleetBox = dialog().getByLabel("Fleet vehicle");
const disabledFirst = await fleetBox.isDisabled();
await dialog().getByLabel("Can be checked out").check();
const enabledAfter = await fleetBox.isEnabled();
await page.keyboard.press("Escape");
const truckId = sql(`select id from assets where name = 'Truck e2e'`);
await page.goto(`${APP_URL}/assets/${truckId}`, { waitUntil: "domcontentloaded" });
const toggleShown = await page.getByLabel("Fleet vehicle").waitFor({ timeout: 60000 }).then(() => true, () => false);
await page.getByLabel("Fleet vehicle").uncheck().catch(() => {});
const unflagged = await until("the flag to clear", `select is_fleet from assets where name = 'Truck e2e'`, "f");
await reset(true, ["manage_assets"]);
await page.goto(`${APP_URL}/assets/${truckId}`, { waitUntil: "domcontentloaded" });
await page.getByText("Truck e2e").first().waitFor({ timeout: 60000 }).catch(() => {});
const toggleWithout = await page.getByLabel("Fleet vehicle").count();
check("21. Add Asset's Fleet vehicle box needs Checkoutable; Asset Detail's toggle is for manage_assets holders and works",
  disabledFirst && enabledAfter && toggleShown && unflagged && toggleWithout === 0,
  `disabled first ${disabledFirst}, enabled after ${enabledAfter}, toggle ${toggleShown}, unflagged ${unflagged}, without manage_assets ${toggleWithout}`);

// ---- 22. motion
async function transitionsOnCheckout(p) {
  page = p;
  await reset();
  await card().waitFor({ timeout: 60000 });
  await page.evaluate(() => {
    window.__vt = 0;
    const start = document.startViewTransition?.bind(document);
    if (start) document.startViewTransition = (cb) => { window.__vt++; return start(cb); };
  });
  await drawer("Truck e2e", "Check out");
  await dialog().getByRole("button", { name: "Check out", exact: true }).click();
  await page.waitForTimeout(1500);
  return page.evaluate(() => window.__vt);
}
const moving = await transitionsOnCheckout(page);
await page.context().close();
const still = await transitionsOnCheckout(await open({ reducedMotion: "reduce" }));
check("22. checking out runs a view transition, and doesn't with reduced motion set",
  moving > 0 && still === 0, `transitions ${moving}, with reduced motion ${still}`);

await browser.close();

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed`);
if (errors.length) console.log("errors:\n  " + errors.join("\n  "));
process.exit(results.every((r) => r.ok) ? 0 : 1);
