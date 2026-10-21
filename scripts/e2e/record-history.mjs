// End-to-end drive of Ticket Updates and Incident Updates
// (src/pages/tickets/TicketDetailPage.spec.md, src/pages/incidents/
// IncidentDetailPage.spec.md), tests 8-10 of the approved list (2026-10-21).
// Run against the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   psql "$DB" -f scripts/e2e/seed-record-history.sql
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/record-history.mjs
//
// Re-seed before each run: it changes the seeded ticket and incident.
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

const ticketId = sql(`select id from tickets where title = 'History e2e ticket'`);
const incidentId = sql(`select id from incidents where title = 'History e2e incident'`);
const checklistId = sql(`select i.id from checklist_instances i join checklist_templates t on t.id = i.template_id where t.name = 'History e2e' and i.status <> 'complete'`);
if (!ticketId || !incidentId || !checklistId) {
  console.error("Seed first: psql -f scripts/e2e/seed-record-history.sql");
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
const kindsOf = (table, col, id) =>
  `select string_agg(kind, ',' order by created_at, id) from ${table} where ${col} = '${id}'`;

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

// ---- 8. Ticket timeline
await page.goto(`${APP_URL}/tickets/${ticketId}`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "History e2e ticket" }).waitFor({ timeout: 120000 });
const timeline = page.getByTestId("ticket-timeline");
await page.getByRole("combobox", { name: "Priority" }).selectOption("high");
await page.getByRole("button", { name: "Take" }).click();
await page.getByRole("textbox", { name: "Add a comment" }).fill("Strike plate was bent.");
await page.getByRole("button", { name: "Add comment" }).click();
const terminalId = sql(`select id from ticket_statuses where is_terminal = true order by position, name limit 1`);
await page.getByRole("combobox", { name: "Status" }).selectOption(terminalId);
await page.waitForTimeout(1500);
// Reselecting the current status adds nothing.
await page.getByRole("combobox", { name: "Status" }).selectOption(terminalId);
await page.waitForTimeout(1500);
const lines8 = await timeline.locator("li").allTextContents();
const uploaded8 = await until("the ticket updates to upload", kindsOf("ticket_updates", "ticket_id", ticketId), "priority,assignee,comment,status");
const resolved = sql(`select resolved_at is not null from tickets where id = '${ticketId}'`) === "t";
await page.screenshot({ path: `${OUT}/record-history-8.png`, fullPage: true });
check("8. the ticket's timeline shows priority, assignment, comment and status in order; resolved_at is set; a no-op adds nothing",
  lines8.length === 5 // the synthesized "Created by" line, then four updates
    && /Created by/.test(lines8[0]) && /Priority Medium → High/.test(lines8[1]) && /Assigned to/.test(lines8[2])
    && /Strike plate was bent/.test(lines8[3]) && /Status .* → /.test(lines8[4])
    && uploaded8 && resolved,
  `lines ${JSON.stringify(lines8.map((l) => l.slice(0, 40)))}, uploaded ${uploaded8}, resolved ${resolved}`);

// ---- 9. Incident timeline
await page.goto(`${APP_URL}/incidents/${incidentId}`, { waitUntil: "domcontentloaded" });
await page.getByRole("heading", { name: "History e2e incident" }).waitFor({ timeout: 120000 });
const itl = page.getByTestId("incident-timeline");
const incTerminal = sql(`select id from incident_statuses where is_terminal = true order by position, name limit 1`);
await page.getByRole("combobox", { name: "Status" }).selectOption(incTerminal);
await page.waitForTimeout(1200);
await page.getByRole("combobox", { name: "Assigned to" }).selectOption({ index: 1 });
await page.waitForTimeout(1200);
await page.getByRole("textbox", { name: /Add an addendum/ }).fill("Owner reminded of the after-hours policy.");
await page.getByRole("button", { name: "Add addendum" }).click();
await page.waitForTimeout(1500);
const kinds9 = await itl.locator("li[data-kind]").evaluateAll((els) => els.map((e) => e.dataset.kind));
const uploaded9 = await until("the incident updates to upload", kindsOf("incident_updates", "incident_id", incidentId), "status,assignee");
const addendumStored = sql(`select count(*) from incident_comments where incident_id = '${incidentId}'`) === "1";
await page.screenshot({ path: `${OUT}/record-history-9.png`, fullPage: true });
check("9. the incident's timeline interleaves status, assignment and the addendum; the addendum is still an incident_comments row",
  kinds9.join(",") === "status,assignee,addendum" && uploaded9 && addendumStored,
  `kinds ${kinds9.join(",")}, uploaded ${uploaded9}, addendum stored ${addendumStored}`);

// ---- 10. Created rows from every path
await page.goto(`${APP_URL}/checklists/${checklistId}`, { waitUntil: "domcontentloaded" });
await page.getByRole("button", { name: /Reject — raise ticket/ }).click({ timeout: 120000 });
// The rejection may ask for a title or confirm; accept defaults where a
// Save/Raise button appears, then submit the checklist.
const raise = page.getByRole("button", { name: /^(Raise|Save|Done)/ }).first();
if (await raise.isVisible().catch(() => false)) await raise.click();
await page.getByRole("button", { name: /^Submit Checklist/ }).click({ timeout: 15000 });
const fromChecklist = await until("the checklist's ticket to upload",
  `select u.to_value from ticket_updates u join tickets t on t.id = u.ticket_id where t.title like '%E2E verify%' and u.kind = 'created' limit 1`,
  "a checklist item");
await page.goto(`${APP_URL}/tickets/new`, { waitUntil: "domcontentloaded" });
await page.locator(".field", { hasText: "Title" }).locator("input").first().fill("History e2e form ticket");
const pick = page.getByRole("button", { name: /Choose|Pick|Attach/ }).first();
if (await pick.isVisible().catch(() => false)) {
  await pick.click();
  await page.getByRole("button", { name: /.+/ }).filter({ hasText: /Slip|Dock|Store|Office|Lot/ }).first().click();
}
await page.getByRole("button", { name: "Create Ticket" }).click();
const fromForm = await until("the form's ticket to upload",
  `select (u.to_value is null)::text from ticket_updates u join tickets t on t.id = u.ticket_id where t.title = 'History e2e form ticket' and u.kind = 'created' limit 1`,
  "true");
check("10. a ticket raised by a checklist and one from the form both start with a created Update, the first naming its origin",
  fromChecklist && fromForm, `checklist ${fromChecklist}, form ${fromForm}`);

await browser.close();
if (errors.length) {
  console.log("\nErrors seen:");
  for (const e of errors) console.log("  " + e);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed || errors.length ? 1 : 0);
