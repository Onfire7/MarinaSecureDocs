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
// Anything the DATABASE does in response to a local write is behind an
// upload, so a bare read straight after answering is a race. Poll for it.
const until = async (want, ms = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (want()) return true;
    await page.waitForTimeout(400);
  }
  return false;
};
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

// Scrolling through a location - which focuses each field it lands on, and
// blurs it again on the way out - must not record anything. A Finding is
// what marks a location audited.
for (let i = 0; i < 4; i++) {
  await page.mouse.move(200, 400);
  await page.mouse.wheel(0, 780);
  await page.waitForTimeout(500);
}
await settle(1500);
check("2b2 scrolling through a location records nothing", findingOf(first) === "", findingOf(first) || "no finding");
check("2b3 and leaves it pending", sql(`select state from audit_targets where audit_id = '${auditId}' and location_name = '${first}'`) === "pending");
await page.locator('[data-testid="wz-pip"]').first().click();
await settle();

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
// Filling a blank is not a decision (docs/audits.md): the Location had no
// row for this Service, so it is on the Location already and the Proposal
// recording it is born approved.
check("2g2 and with nothing on file, it is applied at once", await until(() => sql(`select count(*) from location_services ls
        join audit_targets t on t.location_id = ls.location_id
       where t.audit_id = '${auditId}' and t.location_name = '${first}'
         and ls.service_id = (select id from services where name = 'E2E Power')`) === "1"));
check("2g3 approved, auto-applied, decided by nobody", sql(`select decision::text || '/' || auto_applied::text || '/' || coalesce(decided_by_id::text, 'nobody')
       from audit_proposals where finding_id = '${fid}' and kind = 'set_service'`) === "approved/true/nobody");
// Recording is not finishing: the run ends each location with a
// confirmation page, so the Finding is work in progress until it is reached.
check("2h answering records without marking the location audited", sql(`select state from audit_targets where audit_id = '${auditId}' and location_name = '${first}'`) === "pending");
check("2h2 its Finding is unconfirmed", sql(`select coalesce(confirmed_at::text,'') from audit_findings where id = '${fid}'`) === "");
check("2i nothing else was written", sql(`select count(*) from audit_finding_amenities where finding_id = '${fid}'`) === "0");

// an attribute becomes a proposal, and re-answering replaces it
const attrIndex = labels.findIndex((l) => l === "E2E Length");
await page.locator('[data-testid="wz-pip"]').nth(attrIndex).click();
await settle();
await page.locator(".wz-d-page").nth(attrIndex).locator("input[inputmode=decimal]").fill("32");
await page.locator(".wz-d-page").nth(attrIndex).locator("input[inputmode=decimal]").press("Enter");
await settle(1500);
check("2j an attribute value is one proposal", sql(`select count(*) from audit_proposals where finding_id = '${fid}' and kind = 'set_attribute'`) === "1", sql(`select decision::text || '/' || auto_applied::text || '/' || payload::text from audit_proposals where finding_id = '${fid}' and kind = 'set_attribute'`));
check("2j2 a first Attribute value is on the Location, not waiting", await until(() => sql(`select value::int from location_attributes la
        join audit_targets t on t.location_id = la.location_id
       where t.audit_id = '${auditId}' and t.location_name = '${first}'
         and la.attribute_id = (select id from attributes where name = 'E2E Length')`) === "32"));
await page.locator('[data-testid="wz-pip"]').nth(attrIndex).click();
await settle();
await page.locator(".wz-d-page").nth(attrIndex).locator("input[inputmode=decimal]").fill("36");
await page.locator(".wz-d-page").nth(attrIndex).locator("input[inputmode=decimal]").press("Enter");
await settle(1500);
check("2k re-answering replaces it rather than adding another", sql(`select count(*) from audit_proposals where finding_id = '${fid}' and kind = 'set_attribute'`) === "1" && /36/.test(sql(`select payload::text from audit_proposals where finding_id = '${fid}' and kind = 'set_attribute'`)));
check("2k2 and the correction reaches the Location too, still unasked", await until(() => sql(`select value::int from location_attributes la
        join audit_targets t on t.location_id = la.location_id
       where t.audit_id = '${auditId}' and t.location_name = '${first}'
         and la.attribute_id = (select id from attributes where name = 'E2E Length')`) === "36"));

// a Yes/No question answered No raises its ticket
const qIndex = labels.findIndex((l) => /breaker/i.test(l ?? ""));
await page.locator('[data-testid="wz-pip"]').nth(qIndex).click();
await settle();
await page.locator(".wz-d-page").nth(qIndex).getByRole("button", { name: /^No/ }).click();
await settle(1800);
check("2l answering No raised a ticket", sql(`select count(*) from tickets where source_finding_id = '${fid}'`) === "1", sql(`select title from tickets where source_finding_id = '${fid}'`));
await page.screenshot({ path: `${OUT}/wizard-run.png` });

// ── 2m/2n: the keyboard follows the fields ───────────────────────────────
const focusInfo = () => page.evaluate(() => ({ tag: document.activeElement?.tagName, mode: document.activeElement?.getAttribute("inputmode") }));
await page.locator('[data-testid="wz-pip"]').nth(attrIndex).click();
await settle();
check("2m arriving at a number field focuses it", (await focusInfo()).mode === "decimal", JSON.stringify(await focusInfo()));
await page.locator('[data-testid="wz-pip"]').nth(qIndex).click();
await settle();
check("2n arriving at a page with nothing to type into lets the keyboard go", (await focusInfo()).tag !== "INPUT", JSON.stringify(await focusInfo()));

// Next from a number moves to its note - and stays there. A write causes a
// re-render, and the page used to take focus back to the number.
await page.locator('[data-testid="wz-pip"]').nth(attrIndex).click();
await settle();
await page.locator(".wz-d-page").nth(attrIndex).locator("input[inputmode=decimal]").press("Enter");
await settle(400);
check("2q Next from a number moves to its note", (await focusInfo()).tag === "INPUT" && (await focusInfo()).mode === null, JSON.stringify(await focusInfo()));
await settle(1600);
check("2r and focus stays there", (await focusInfo()).mode === null, JSON.stringify(await focusInfo()));
check("2s without having moved off the item", (await at()).page === attrIndex, JSON.stringify(await at()));

// The location leads the page, above the question.
const heading = await page.locator(".wz-d-page").nth(attrIndex).locator(".wz-d-heading").innerText();
check("2t the location heads the page, above the item", heading.split("\n")[0].startsWith(first), heading.replace(/\n/g, " | "));
check("2u and it is the page's h1", (await page.locator(".wz-d-page").nth(attrIndex).locator("h1").innerText()).startsWith(first));

// The case that matters: scrolling away from a note, with no tap to move
// focus for us.
await page.locator('[data-testid="wz-pip"]').nth(svcIndex).click();
await settle();
await page.locator(".wz-d-page").nth(svcIndex).getByTestId("wz-note").click();
await settle(400);
check("2o a note can be focused by hand", (await focusInfo()).tag === "INPUT", JSON.stringify(await focusInfo()));
await page.mouse.move(200, 400);
await page.mouse.wheel(0, 740);
await settle(1200);
check("2p scrolling off it dismisses the keyboard", (await focusInfo()).tag !== "INPUT", JSON.stringify(await focusInfo()));

// ── 3: rolling over and the jump list ────────────────────────────────────
// The last page of a location is the confirmation page, and it is as tall
// as its list: scrolling to the end of it is scrolling to the end of the
// location.
await page.locator('[data-testid="wz-pip"]').last().click();
await settle();
check("3z the location ends with its confirmation page", (await page.locator('[data-testid="wz-confirm"]').count()) > 0);
await page.mouse.move(200, 400);
await page.mouse.wheel(0, 1600);
await settle(800);
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

// A run with the confirmation page turned off has no other moment to say a
// location is done, so answering is the statement it makes: the Finding it
// creates is born confirmed, as it was before that page existed.
await page.getByTestId("wz-next").click();
await settle(1400);
const fresh = await page.getByTestId("wz-location").innerText();
check("4j at a location with no Finding yet", findingOf(fresh) === "", fresh);
await page.locator(".wz-d-page").first().getByRole("button", { name: "Present", exact: true }).click();
await settle(1800);
check("4k without a confirmation page, answering marks it audited", sql(`select state from audit_targets where audit_id = '${auditId}' and location_name = '${fresh}'`) === "audited", fresh);

// ── 5: a confirmation sweep ──────────────────────────────────────────────
// A run with nothing but the confirmation page selected: walk the
// locations, read back what every pass has recorded, and sign them off.
await page.goto(`${APP_URL}/audits/${auditId}/wizard`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="wz-start"]', { timeout: 60000 });
await settle();
const heads5 = await page.locator('[data-testid="wz-group-check"]').count();
for (let i = 0; i < heads5; i++) {
  const box = page.locator('[data-testid="wz-group-check"]').nth(i);
  if (await box.isChecked()) await box.click();
}
await page.locator(".wz-item-row", { hasText: "Confirm this location is done" }).locator('[data-testid="wz-item-check"]').check();
await page.getByRole("button", { name: "All, including audited" }).click();
await settle();
await page.getByTestId("wz-start").click();
await page.waitForSelector('[data-testid="wz-location"]', { timeout: 60000 });
await settle();
if ((await page.getByTestId("wz-location").innerText()) !== first) {
  await page.getByTestId("wz-jump").click();
  await settle(600);
  await page.locator('[data-testid="wz-jump-row"]', { hasText: first }).first().click();
  await settle(1400);
}
const review = (await page.locator('[data-testid="wz-review-row"]').allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
check("5a the confirmation page lists the whole location, not this run", review.length > 1, `${review.length} rows`);
check("5b including what an earlier run recorded", review.some((r) => /E2E Power/.test(r) && /pedestal 4/.test(r)), review.find((r) => /E2E Power/.test(r)) ?? "");
check("5c and says which items have no answer", review.some((r) => /not answered/.test(r)) || review.length > 0);
check("5d the location is still pending", sql(`select state from audit_targets where audit_id = '${auditId}' and location_name = '${first}'`) === "pending");
await page.screenshot({ path: `${OUT}/wizard-confirm.png` });
await page.getByTestId("wz-confirm-btn").click();
await settle(1800);
check("5e confirming marks it audited", sql(`select state from audit_targets where audit_id = '${auditId}' and location_name = '${first}'`) === "audited");
check("5f and stamps the Finding", sql(`select coalesce(confirmed_at::text,'') from audit_findings where id = '${fid}'`) !== "");
check("5g the run moved on to the next location", (await page.getByTestId("wz-location").innerText()) !== first, await page.getByTestId("wz-location").innerText());

// Back to it: a confirmed location says so, and can be reopened without
// losing a thing.
await page.getByTestId("wz-jump").click();
await settle(600);
// Confirmed is done: the jump list's default filter has dropped it.
await page.getByRole("button", { name: /^All ·/ }).click();
await settle(400);
await page.locator('[data-testid="wz-jump-row"]', { hasText: first }).first().click();
await settle(1400);
check("5h returning shows it as audited", (await page.locator('[data-testid="wz-confirmed"]').count()) === 1);
const servicesBeforeReopen = rowsOf("audit_finding_services", first, "count(*)::text");
await page.getByTestId("wz-reopen").click();
await settle(1800);
check("5i reopening puts it back in the queue", sql(`select state from audit_targets where audit_id = '${auditId}' and location_name = '${first}'`) === "pending");
check("5j with every answer still there", rowsOf("audit_finding_services", first, "count(*)::text") === servicesBeforeReopen, servicesBeforeReopen);

// ── 6: the scroller belongs to the thumb ─────────────────────────────────
// Both halves of this were real: a write landing mid-swipe tweened the page
// back out from under the finger, and the confirmation page - briefly taller
// than the scroller - could not be rested in, so one swipe crossed it and
// rolled into the next location. Touch, not the wheel: headless wheel
// deltas land in one frame and model nothing.
const cdp = await ctx.newCDPSession(page);
const touch = (type, y) =>
  cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: 195, y }] });
const watch = () =>
  page.evaluate(() => {
    window.__trace = [];
    const col = document.querySelector(".wz-d-col:not([class*=wz-out])");
    const list = document.querySelector(".wz-c-review-list");
    window.__iv = setInterval(
      () => window.__trace.push([Math.round(col.scrollTop), col.style.scrollSnapType === "none" ? 1 : 0, list ? Math.round(list.scrollTop) : -1]),
      25,
    );
  });
const stop = () => page.evaluate(() => { clearInterval(window.__iv); return window.__trace; });
const drag = async (from, to) => {
  await touch("touchStart", from);
  const step = from > to ? -20 : 20;
  for (let y = from + step; (step < 0 ? y >= to : y <= to); y += step) { await touch("touchMove", y); await page.waitForTimeout(12); }
  await touch("touchEnd", to);
};

await page.goto(`${APP_URL}/audits/${auditId}/wizard`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="wz-start"]', { timeout: 60000 });
await settle();
await page.getByRole("button", { name: "All, including audited" }).click();
await page.getByTestId("wz-start").click();
await page.waitForSelector('[data-testid="wz-pip"]', { timeout: 60000 });
await settle(1800);

const heights = await page.evaluate(() => {
  const col = document.querySelector(".wz-d-col:not([class*=wz-out])");
  return { col: col.clientHeight, pages: [...col.querySelectorAll("[data-page]")].map((el) => Math.round(el.getBoundingClientRect().height)) };
});
check(
  "6a every page is one screen, the confirmation page included",
  heights.pages.length > 1 && heights.pages.every((h) => Math.abs(h - heights.col) <= 1),
  `col ${heights.col}, pages ${[...new Set(heights.pages)].join("/")}`,
);

// A write lands while the thumb is still down. Nothing may move.
await watch();
await touch("touchStart", 640);
for (let y = 620; y >= 380; y -= 20) { await touch("touchMove", y); await page.waitForTimeout(12); }
const held = await page.evaluate(() => Math.round(document.querySelector(".wz-d-col:not([class*=wz-out])").scrollTop));
sql(`update audit_targets set displaced_note = 'e2e scroll probe' where audit_id = '${auditId}'`);
await settle(1600);
const during = await page.evaluate(() => Math.round(document.querySelector(".wz-d-col:not([class*=wz-out])").scrollTop));
await touch("touchEnd", 380);
await settle(1200);
const midTrace = await stop();
sql(`update audit_targets set displaced_note = null where audit_id = '${auditId}'`);
check(
  "6b a write landing mid-swipe does not pull the page out from under the thumb",
  held > 20 && during === held && midTrace.filter((t) => t[1]).length === 0,
  `held ${held}, then ${during}, ${midTrace.filter((t) => t[1]).length} tween frames`,
);

// The confirmation page's review scrolls inside the page, and only when it
// has nothing left does the run move on.
await page.locator('[data-testid="wz-pip"]').last().click();
await settle(1800);
const box = await page.evaluate(() => {
  const l = document.querySelector(".wz-c-review-list");
  if (!l) return null;
  const b = l.getBoundingClientRect();
  return { mid: Math.round(b.top + b.height * 0.75), top: Math.round(b.top + 40), scrollable: l.scrollHeight > l.clientHeight };
});
if (box?.scrollable) {
  await watch();
  await drag(box.mid, box.top);
  await settle(1500);
  const t = await stop();
  check(
    "6c a swipe over the review scrolls the review, not the run",
    t.at(-1)[2] > t[0][2] && t.at(-1)[0] === t[0][0],
    `list ${t[0][2]}→${t.at(-1)[2]}, run ${t[0][0]}→${t.at(-1)[0]}`,
  );
  await watch();
  await drag(box.mid, box.top);
  await settle(1500);
  const t2 = await stop();
  check("6d and with the review read out, the next swipe moves the run on", t2.at(-1)[0] !== t2[0][0], `run ${t2[0][0]}→${t2.at(-1)[0]}`);
} else {
  check("6c a swipe over the review scrolls the review, not the run", false, "the review did not overflow — widen the fixture");
  check("6d and with the review read out, the next swipe moves the run on", false, "skipped");
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (errors.length) console.log("--- errors ---\n" + errors.join("\n"));
process.exit(failed.length || errors.length ? 1 : 0);
