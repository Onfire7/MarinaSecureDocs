// End-to-end: a location on several maps (docs/maps.md § A location on
// several maps; tests E1-E4 approved 2026-10-19), against a running app
// signed in with the state agent-login.mjs saved. Run against the LOCAL
// stack, as scripts/e2e/audit-wizard.mjs is:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   psql "$DB" -f scripts/e2e/seed-location-maps.sql
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/location-maps.mjs
//
// The seed puts one location on 'E2E Dock Map' (scoped to its parent) and
// 'E2E Overview', with 'E2E Third Map' beside them, and opens an audit
// that asks only about the map.
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

const auditId = sql(`select id from audits where name = 'Maps e2e' and status = 'open'`);
if (!auditId) {
  console.error("Seed first: psql -f scripts/e2e/seed-location-maps.sql");
  process.exit(2);
}
const [locId, locName] = sql(`select location_id || '|' || location_name from audit_targets where audit_id = '${auditId}'`).split("|");
const mapId = (name) => sql(`select id from marina_maps where name = '${name}'`);
const DOCK = mapId("E2E Dock Map");
const OVER = mapId("E2E Overview");
const THIRD = mapId("E2E Third Map");
const findingId = () => sql(`select f.id from audit_findings f join audit_targets t on t.id = f.target_id where t.audit_id = '${auditId}'`);
const placementMaps = () =>
  sql(`select string_agg(json_extract_path_text(payload::json, 'map_id'), ',' order by json_extract_path_text(payload::json, 'map_id'))
         from audit_proposals where finding_id = '${findingId()}' and kind = 'move_placement' and decision is null`);
const mapsOn = () =>
  sql(`select string_agg(distinct map_id::text, ',' order by map_id::text) from
         (select map_id from map_anchors where location_id = '${locId}' union select map_id from map_labels where location_id = '${locId}') x`);
const sorted = (...ids) => [...ids].sort().join(",");

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
const until = async (want, ms = 10000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (want()) return true;
    await page.waitForTimeout(400);
  }
  return false;
};
/** Tap the editor's map at a fraction of its box, then Done. */
const placeInEditor = async (fx, fy) => {
  const stage = page.locator(".mle-map");
  await stage.waitFor({ timeout: 10000 });
  const b = await stage.boundingBox();
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  await settle(400);
  await page.getByTestId("mle-done").click();
  await settle();
};
const mapPage = () => page.locator(".wz-d-page", { has: page.getByTestId("pc-map") }).first();

// ── open the run on the map page ─────────────────────────────────────────
await page.goto(`${APP_URL}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="start-wizard"]', { timeout: 120000 });
await page.getByTestId("start-wizard").click();
await page.waitForSelector('[data-testid="wz-start"]', { timeout: 60000 });
await page.getByTestId("wz-start").click();
await page.waitForSelector('[data-testid="wz-location"]', { timeout: 60000 });
await page.locator('[data-testid="wz-pip"][title="On the map"]').click();
await settle(1500);

// ── E1: the chooser marks both maps, and opens on the dock's ────────────
const chooser = mapPage().getByTestId("pc-map");
const options = await chooser.locator("option").evaluateAll((els) => els.map((e) => ({ value: e.value, text: e.textContent.trim() })));
const marked = (id) => /✓/.test(options.find((o) => o.value === id)?.text ?? "");
check("E1a every map is offered", [DOCK, OVER, THIRD].every((id) => options.some((o) => o.value === id)), options.map((o) => o.text).join(" | "));
check("E1b the two it is on are marked, the third is not", marked(DOCK) && marked(OVER) && !marked(THIRD));
check("E1c it opens on its dock's map", (await chooser.inputValue()) === DOCK, await chooser.inputValue());
check("E1d no Yes/No question is asked", (await mapPage().getByText("Is it placed correctly", { exact: false }).count()) === 0);
await page.screenshot({ path: `${OUT}/maps-e1-chooser.png` });

// ── E2: Done with no change ──────────────────────────────────────────────
await mapPage().getByTestId("pc-done").click();
check("E2a Done records no changes", await until(() => sql(`select mapped_correctly from audit_findings where id = '${findingId() || "00000000-0000-0000-0000-000000000000"}'`) === "t"));
check("E2b and proposes nothing", placementMaps() === "");
await page.locator('[data-testid="wz-pip"][title="On the map"]').click();
await settle(1200);

// ── E3: adjust on the dock's map, place on the third ─────────────────────
await mapPage().getByTestId("pc-adjust").click();
const subject = page.getByTestId("mle-subject");
await subject.waitFor({ timeout: 10000 });
const sb = await subject.boundingBox();
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
await page.mouse.down();
await page.mouse.move(sb.x + sb.width / 2 + 40, sb.y + sb.height / 2 + 30, { steps: 8 });
await page.mouse.up();
await settle(400);
await page.getByTestId("mle-done").click();
await settle();
await mapPage().getByTestId("pc-map").selectOption(THIRD);
await settle(800);
await mapPage().getByTestId("pc-place").click();
await placeInEditor(0.3, 0.3);
check("E3a the third map is now marked", /✓/.test(await mapPage().locator(`[data-testid="pc-map"] option[value="${THIRD}"]`).innerText()));
await mapPage().getByTestId("pc-done").click();
check("E3b one Proposal per map changed: the dock's and the third", await until(() => placementMaps() === sorted(DOCK, THIRD)), placementMaps());
check("E3c Done with changes records them", await until(() => sql(`select mapped_correctly from audit_findings where id = '${findingId()}'`) === "f"));
await page.screenshot({ path: `${OUT}/maps-e3-proposed.png` });

// Approve and finalize as the signed-in user, through the permission rules.
const clerk = sql(`select u.clerk_user_id from audit_assignees a join users u on u.id = a.user_id where a.audit_id = '${auditId}' limit 1`);
const me = sql(`select user_id from audit_assignees where audit_id = '${auditId}' limit 1`);
sql(`update audit_targets set state = 'audited' where audit_id = '${auditId}' and state = 'pending'`);
sql(`begin; select set_config('request.jwt.claims', '{"sub":"${clerk}"}', true); set local role authenticated;
     update audit_proposals set decision = 'approved', decided_by_id = '${me}' where finding_id = '${findingId()}' and decision is null;
     select finalize_audit('${auditId}'); commit;`);
check("E3d approved, it is on all three maps - nothing was taken off", mapsOn() === sorted(DOCK, OVER, THIRD), mapsOn());

// ── E4: the admin row lists every map; Remove and Add act on one ─────────
const admin = await browser.newContext({ storageState: "/tmp/pw-test/state.json", viewport: { width: 1280, height: 900 } });
const ap = await admin.newPage();
ap.on("pageerror", (e) => errors.push("admin pageerror: " + e.message));
const chain = sql(`with recursive up as (select id, parent_id from locations where id = '${locId}'
                     union all select l.id, l.parent_id from locations l join up on l.id = up.parent_id)
                   select string_agg(id::text, ',') from up`).split(",");
await ap.goto(`${APP_URL}/admin/locations`, { waitUntil: "domcontentloaded" });
await ap.evaluate((ids) => localStorage.setItem("marinasecure.admin.locations.expanded", JSON.stringify(ids)), chain);
await ap.reload({ waitUntil: "domcontentloaded" });
await ap.waitForSelector('[data-testid="loc-map-row"]', { timeout: 60000 });
await ap.waitForTimeout(1500);
const rowFor = (id) => ap.locator(`[data-testid="loc-map-row"][data-map-id="${id}"]`);
check("E4a the row lists all three maps", (await rowFor(DOCK).count()) === 1 && (await rowFor(OVER).count()) === 1 && (await rowFor(THIRD).count()) === 1);
await ap.screenshot({ path: `${OUT}/maps-e4-admin.png` });
await rowFor(OVER).getByTestId("loc-map-remove").click();
check("E4b Remove takes it off that map only", await until(() => mapsOn() === sorted(DOCK, THIRD)), mapsOn());
await ap.getByTestId("loc-map-add").selectOption(OVER);
const stage = ap.locator(".mle-map");
await stage.waitFor({ timeout: 10000 });
const b = await stage.boundingBox();
await ap.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5);
await ap.waitForTimeout(400);
await ap.getByTestId("mle-done").click();
check("E4c Add to another map puts it back on that one", await until(() => mapsOn() === sorted(DOCK, OVER, THIRD)), mapsOn());

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (errors.length) console.log("--- errors ---\n" + errors.join("\n"));
process.exit(failed.length || errors.length ? 1 : 0);
