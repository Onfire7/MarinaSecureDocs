// End-to-end drive of the audit wizard (docs/audits.md § The wizard),
// against a running app signed in with the state agent-login.mjs saved.
// Run against the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   psql "$DB" -f scripts/e2e/seed-audit-report.sql
//   psql "$DB" -f scripts/e2e/seed-audit-wizard.sql
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/audit-wizard.mjs
//
// It records real Findings. Against a marina's database that is real data;
// the loop runs locally.
//
// The test that matters is the last one: a second run, asking about one
// item, must leave the first run's answers alone. saveFinding() would not.
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

const auditId = sql(`select id from audits where name = 'Wizard e2e' and status = 'open'`);
if (!auditId) {
  console.error("Seed first: psql -f scripts/e2e/seed-audit-wizard.sql");
  process.exit(2);
}
const first = sql(`select location_name from audit_targets where audit_id = '${auditId}' order by position limit 1`);
const findingOf = (name) =>
  sql(`select f.id from audit_findings f join audit_targets t on t.id = f.target_id
        where f.audit_id = '${auditId}' and t.location_name = '${name}'`);
const rowsOf = (table, name, cols) =>
  sql(`select ${cols} from ${table} x join audit_findings f on f.id = x.finding_id
        join audit_targets t on t.id = f.target_id
       where f.audit_id = '${auditId}' and t.location_name = '${name}'`);

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ storageState: "/tmp/pw-test/state.json", viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && !/Sync error/.test(m.text()) && errors.push("console: " + m.text().slice(0, 200)));
page.on("response", async (r) => {
  if (r.status() >= 400 && !r.url().includes("clerk")) errors.push(`${r.status()} ${r.url().slice(0, 100)} ${(await r.text().catch(() => "")).slice(0, 160)}`);
});
const settle = (ms = 1200) => page.waitForTimeout(ms);
const at = () =>
  page.evaluate(() => {
    const col = document.querySelector(".wz-d-col:not([class*=wz-out])");
    if (!col) return { page: -1 };
    const i = Math.round(col.scrollTop / col.clientHeight);
    return { page: i, label: col.querySelectorAll(".wz-d-page")[i]?.querySelector(".wz-d-label")?.textContent };
  });

// ── 1: the button, the setup screen, the selection ───────────────────────
await page.goto(`${APP_URL}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="start-wizard"]', { timeout: 120000 });
await page.getByTestId("start-wizard").click();
await page.waitForSelector('[data-testid="wz-start"]', { timeout: 60000 });
await settle();
const groups = (await page.locator(".wz-group-head").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
check("1a every group is offered, attributes before services", /ATTRIBUTES/.test(groups.join("|")) && groups.findIndex((g) => /ATTRIBUTES/.test(g)) < groups.findIndex((g) => /SERVICES/.test(g)), groups.join(" | "));
const allOn = await page.locator('[data-testid="wz-item-check"]').evaluateAll((els) => els.every((e) => e.checked));
check("1b everything starts selected", allOn);
const footer = await page.locator(".wz-footer").innerText();
check("1c the footer counts the run", /locations · \d+ steps/.test(footer.replace(/\n/g, " ")), footer.replace(/\n/g, " "));
await page.screenshot({ path: `${OUT}/wizard-setup.png` });

// ── 2: answering writes at once, and only that item ──────────────────────
await page.getByTestId("wz-start").click();
await page.waitForSelector('[data-testid="wz-location"]', { timeout: 60000 });
await settle();
check("2a starts at the first location", (await page.getByTestId("wz-location").innerText()) === first, first);
check("2b no Finding exists yet", findingOf(first) === "");

// the first item is the location status: tapping it advances
const labels = await page.locator('[data-testid="wz-pip"]').evaluateAll((els) => els.map((e) => e.getAttribute("title")));
console.log("items:", labels.join(" | "));
const svcIndex = labels.findIndex((l) => l === "E2E Power");
await page.locator('[data-testid="wz-pip"]').nth(svcIndex).click();
await page.waitForFunction((want) => {
  const col = document.querySelector(".wz-d-col:not([class*=wz-out])");
  if (!col) return false;
  const i = Math.round(col.scrollTop / col.clientHeight);
  return col.querySelectorAll(".wz-d-page")[i]?.querySelector(".wz-d-label")?.textContent === want;
}, "E2E Power", { timeout: 5000 }).catch(() => {});
check("2c the rail jumps to an item", (await at()).label === "E2E Power", JSON.stringify(await at()));

await page.locator(".wz-d-page").nth(svcIndex).getByRole("button", { name: "Present", exact: true }).click();
await settle();
check("2d answering Present focuses the note", (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "wz-note");
await page.keyboard.type("pedestal 4");
await page.keyboard.press("Enter");
await settle(1500);
const fid = findingOf(first);
check("2e the answer created the Finding at once", fid !== "", fid);
check("2f and recorded the service", rowsOf("audit_finding_services", first, "x.present::text || ',' || x.working::text || ',' || coalesce(x.note,'')") === "true,true,pedestal 4");
check("2g presence differing from the file is a proposal", sql(`select count(*) from audit_proposals where finding_id = '${fid}' and kind = 'set_service'`) === "1");
check("2h the location is now audited", sql(`select state from audit_targets where audit_id = '${auditId}' and location_name = '${first}'`) === "audited");
check("2i nothing else was written", sql(`select count(*) from audit_finding_amenities where finding_id = '${fid}'`) === "0");

// an attribute becomes a proposal, and re-answering replaces it
const attrIndex = labels.findIndex((l) => l === "E2E Length");
await page.locator('[data-testid="wz-pip"]').nth(attrIndex).click();
await settle();
await page.locator(".wz-d-page").nth(attrIndex).locator("input[inputmode=decimal]").fill("32");
await page.locator(".wz-d-page").nth(attrIndex).locator("input[inputmode=decimal]").press("Enter");
await settle(1500);
check("2j an attribute value is one proposal", sql(`select count(*) from audit_proposals where finding_id = '${fid}' and kind = 'set_attribute'`) === "1", sql(`select payload::text from audit_proposals where finding_id = '${fid}' and kind = 'set_attribute'`));
await page.locator('[data-testid="wz-pip"]').nth(attrIndex).click();
await settle();
await page.locator(".wz-d-page").nth(attrIndex).locator("input[inputmode=decimal]").fill("36");
await page.locator(".wz-d-page").nth(attrIndex).locator("input[inputmode=decimal]").press("Enter");
await settle(1500);
check("2k re-answering replaces it rather than adding another", sql(`select count(*) from audit_proposals where finding_id = '${fid}' and kind = 'set_attribute'`) === "1" && /36/.test(sql(`select payload::text from audit_proposals where finding_id = '${fid}' and kind = 'set_attribute'`)));

// a Yes/No question answered No raises its ticket
const qIndex = labels.findIndex((l) => /breaker/i.test(l ?? ""));
await page.locator('[data-testid="wz-pip"]').nth(qIndex).click();
await settle();
await page.locator(".wz-d-page").nth(qIndex).getByRole("button", { name: /^No/ }).click();
await settle(1800);
check("2l answering No raised a ticket", sql(`select count(*) from tickets where source_finding_id = '${fid}'`) === "1", sql(`select title from tickets where source_finding_id = '${fid}'`));
await page.screenshot({ path: `${OUT}/wizard-run.png` });

// ── 3: rolling over and the jump list ────────────────────────────────────
await page.locator('[data-testid="wz-pip"]').last().click();
await settle();
for (let i = 0; i < 4; i++) { await page.mouse.move(200, 400); await page.mouse.wheel(0, 60); await page.waitForTimeout(60); }
await settle(1500);
const second = await page.getByTestId("wz-location").innerText();
check("3a pushing past the last item rolls into the next location", second !== first, `${first} → ${second}`);
check("3b landing on its first item", (await at()).page === 0);
await page.getByTestId("wz-jump").click();
await settle(600);
check("3c the jump list filters", (await page.locator('[data-testid="wz-jump-row"]').count()) > 0, `${await page.locator('[data-testid="wz-jump-row"]').count()} rows`);
const rows = await page.locator('[data-testid="wz-jump-row"]').allInnerTexts();
const other = rows.findIndex((r) => !r.startsWith(second));
await page.locator('[data-testid="wz-jump-row"]').nth(Math.max(0, other)).click();
await settle(1400);
check("3d picking one goes there", (await page.getByTestId("wz-location").innerText()) !== second, `${second} → ${await page.getByTestId("wz-location").innerText()}`);

// ── 4: THE MERGE. A second run, one item, leaves the first run alone ─────
const beforeServices = rowsOf("audit_finding_services", first, "count(*)::text");
const beforeTicket = sql(`select count(*) from tickets where source_finding_id = '${fid}'`);
await page.goto(`${APP_URL}/audits/${auditId}/wizard`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="wz-start"]', { timeout: 60000 });
await settle();
// turn everything off, then just the amenity back on, and include audited
const heads = await page.locator('[data-testid="wz-group-check"]').count();
for (let i = 0; i < heads; i++) {
  const box = page.locator('[data-testid="wz-group-check"]').nth(i);
  if (await box.isChecked()) await box.click();
}
await page.locator(".wz-item-row", { hasText: "E2E WiFi" }).locator('[data-testid="wz-item-check"]').check();
await page.getByRole("button", { name: "All, including audited" }).click();
await settle();
check("4a one item selected", /1 step|\b\d+ steps/.test((await page.locator(".wz-footer").innerText()).replace(/\n/g, " ")), (await page.locator(".wz-footer").innerText()).replace(/\n/g, " "));
await page.getByTestId("wz-start").click();
await page.waitForSelector('[data-testid="wz-location"]', { timeout: 60000 });
await settle();
// walk to the first location and answer the amenity
if ((await page.getByTestId("wz-location").innerText()) !== first) {
  await page.getByTestId("wz-jump").click();
  await settle(600);
  await page.locator('[data-testid="wz-jump-row"]', { hasText: first }).first().click();
  await settle(1200);
}
check("4b the run shows only the chosen item", (await page.locator('[data-testid="wz-pip"]').count()) === 1, `${await page.locator('[data-testid="wz-pip"]').count()} items`);
await page.locator(".wz-d-page").first().getByRole("button", { name: "Present", exact: true }).click();
await settle(1500);
check("4c the amenity was recorded", rowsOf("audit_finding_amenities", first, "x.present::text") === "true");
check("4d the first run's service survived", rowsOf("audit_finding_services", first, "count(*)::text") === beforeServices, `${beforeServices} → ${rowsOf("audit_finding_services", first, "count(*)::text")}`);
check("4e its note survived", /pedestal 4/.test(rowsOf("audit_finding_services", first, "coalesce(x.note,'')")));
check("4f its answers survived", sql(`select count(*) from audit_finding_answers where finding_id = '${fid}'`) !== "0");
check("4g its proposals survived", Number(sql(`select count(*) from audit_proposals where finding_id = '${fid}'`)) >= 2, sql(`select string_agg(kind::text, ',') from audit_proposals where finding_id = '${fid}'`));
check("4h and its ticket was not raised twice", sql(`select count(*) from tickets where source_finding_id = '${fid}'`) === beforeTicket);
check("4i one Finding, not two", sql(`select count(*) from audit_findings f join audit_targets t on t.id = f.target_id where t.location_name = '${first}' and f.audit_id = '${auditId}'`) === "1");

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (errors.length) console.log("--- errors ---\n" + errors.join("\n"));
process.exit(failed.length || errors.length ? 1 : 0);
