// End-to-end drive of the Shift Report's Vehicles section
// (src/pages/reports/ShiftReportPage.spec.md § Vehicles): status lines,
// standalone mileage readings, and pointers to what was raised on a vehicle.
// Test 6 of the approved list (2026-10-21). Run against the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   psql "$DB" -f scripts/e2e/seed-shift-vehicles.sql
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/shift-vehicles.mjs
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

const shiftId = sql(`select s.id from shifts s join users u on u.id = s.guard_id
  where u.email = 'gpp@onfire.us' and s.ended_at is not null
    and exists (select 1 from asset_checkouts co join assets a on a.id = co.asset_id
                 where a.name = 'Patrol Truck e2e' and co.time_out between s.started_at and s.ended_at)
  order by s.started_at desc limit 1`);
const incidentId = sql(`select id from incidents where title = 'Scraped mirror e2e'`);
const ticketId = sql(`select id from tickets where title = 'Replace mirror e2e'`);
if (!shiftId || !incidentId || !ticketId) {
  console.error("Seed first: psql -f scripts/e2e/seed-shift-vehicles.sql");
  process.exit(2);
}

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

await page.goto(`${APP_URL}/reports/shifts/${shiftId}`, { waitUntil: "domcontentloaded" });
const section = page.getByTestId("shift-vehicles");
await section.getByText("Patrol Truck e2e").waitFor({ timeout: 120000 });
await page.waitForTimeout(1500);

const truck = section.locator(".card", { hasText: "Patrol Truck e2e" });
const cart = section.locator(".card", { hasText: "Cart e2e" });
const truckText = (await truck.textContent()) ?? "";
const cartText = (await cart.textContent()) ?? "";
const incidentHref = await truck.locator(`a[href="#incident-${incidentId}"]`).count();
const ticketHref = await truck.locator(`a[href="#ticket-${ticketId}"]`).count();
const incidentAnchor = await page.locator(`#incident-${incidentId}`).count();
const ticketAnchor = await page.locator(`#ticket-${ticketId}`).count();
await page.screenshot({ path: `${OUT}/shift-vehicles-6.png`, fullPage: true });

check("6. the Vehicles section shows the status, the pointers, and a mileage-only vehicle",
  /Status → Needs Cleaning/.test(truckText)
    && /Incident: Scraped mirror e2e/.test(truckText)
    && /Ticket: Replace mirror e2e/.test(truckText)
    && incidentHref === 1 && ticketHref === 1 && incidentAnchor === 1 && ticketAnchor === 1
    && /Mileage: 18,240 mi/.test(cartText)
    && !/Status/.test(cartText) && !/–/.test(cartText),
  `truck ${JSON.stringify(truckText.slice(0, 300))} · cart ${JSON.stringify(cartText.slice(0, 120))} · links ${incidentHref}/${ticketHref} anchors ${incidentAnchor}/${ticketAnchor}`);

await browser.close();
if (errors.length) {
  console.log("\nErrors seen:");
  for (const e of errors) console.log("  " + e);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
