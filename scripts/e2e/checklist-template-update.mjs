// End-to-end drive of "Update open checklists" on the template builder
// (src/pages/admin/AdminChecklistTemplatesPage.spec.md), tests 18–20 of the
// approved list. Run against the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   psql "$DB" -f scripts/e2e/seed-checklist-template-update.sql
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/checklist-template-update.mjs
//
// It edits a template and rewrites an open checklist. Re-seed before each run.
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

const templateId = sql(`select id from checklist_templates where name = 'Update e2e'`);
const openId = sql(`select id from checklist_instances where template_id = '${templateId}' and status <> 'complete'`);
const oldId = sql(`select id from checklist_instances where template_id = '${templateId}' and status = 'complete'`);
if (!templateId || !openId || !oldId || sql(`select count(*) from checklist_template_items where label like 'E2E % v2'`) !== "0") {
  console.error("Seed first: psql -f scripts/e2e/seed-checklist-template-update.sql");
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

const labelsOn = (instanceId) =>
  sql(`select string_agg(ti.label, ' | ' order by ti.label)
         from checklist_instance_items ii
         join checklist_instance_sections s on s.id = ii.section_id
         join checklist_template_items ti on ti.id = ii.template_item_id
        where s.instance_id = '${instanceId}'`);

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "/tmp/pw-test/state.json", viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
let dialogs = 0;
page.on("dialog", (d) => { dialogs++; void d.accept(); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error" || m.text().includes("Discarding")) errors.push("console: " + m.text().slice(0, 200));
});
page.on("response", async (r) => {
  if (r.status() >= 400 && !r.url().includes("clerk")) errors.push(`${r.status()} ${r.url().slice(0, 100)} ${(await r.text().catch(() => "")).slice(0, 160)}`);
});

const BANNER = /open checklists? differs? from this template/;

async function openTemplate() {
  await page.goto(`${APP_URL}/admin/checklist-templates`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Update e2e", exact: true }).click({ timeout: 120000 });
  const card = page.locator(".card", { has: page.locator('input[aria-label="Template name"][value="Update e2e"]') });
  await card.waitFor();
  return card;
}

async function editLabel(card, from, to) {
  await card.getByRole("button", { name: from, exact: true }).click();
  const input = card.locator(`input[aria-label="Item label"][value="${from}"]`);
  await input.fill(to);
  // The locator matched on the old value; the focused field is still it.
  await page.keyboard.press("Tab");
  await card.locator(`input[aria-label="Item label"][value="${to}"]`).waitFor();
}

// ── 18: one banner for a batch of edits, and no question per edit ─────────
{
  const card = await openTemplate();
  const before = await page.getByText(BANNER).count();
  await card.getByRole("button", { name: /^Dock \| / }).click();

  await editLabel(card, "E2E unanswered", "E2E unanswered v2");
  await editLabel(card, "E2E answered", "E2E answered v2");
  await card
    .locator(".card", { has: page.getByRole("button", { name: "E2E removed", exact: true }) })
    .last()
    .getByRole("button", { name: "Remove this item" })
    .click();
  await card.locator("select", { has: page.locator("option", { hasText: "Add an item…" }) }).selectOption("simple_check");
  const added = card.locator('input[aria-label="Item label"][value="Simple Check"]');
  await added.fill("E2E added");
  await page.keyboard.press("Tab");
  await card.locator('input[aria-label="Item label"][value="E2E added"]').waitFor();

  await page.getByText(BANNER).first().waitFor({ timeout: 15000 });
  const banners = await page.getByText(BANNER).allInnerTexts();
  check(
    "18 a batch of edits raises one banner, counting one checklist, and no dialog",
    before === 0 && banners.length === 1 && banners[0].startsWith("1 open checklist differs") && dialogs === 0,
    `before=${before} banners=${JSON.stringify(banners)} dialogs=${dialogs}`,
  );
  await page.screenshot({ path: `${OUT}/e2e-18-banner.png` });
}

// ── 19: Update applies the whole batch, keeping what was answered ─────────
{
  await page.getByRole("button", { name: "Update it" }).click();
  await page.getByText("Updated 1 checklist.").waitFor({ timeout: 15000 });
  const bannerGone = (await page.getByText(BANNER).count()) === 0;
  await page.screenshot({ path: `${OUT}/e2e-19-updated.png` });

  const uploaded = await until(
    "the update to upload",
    `select count(*) from activity_log_entries where event_type = 'checklist.updated' and subject_id = '${openId}'`,
    "1",
  );
  const serverLabels = labelsOn(openId);

  await page.goto(`${APP_URL}/checklists/${openId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("E2E unanswered v2").first().waitFor({ timeout: 60000 });
  const text = await page.locator("body").innerText();
  const has = (s) => text.split("\n").some((line) => line.trim() === s);
  check(
    "19 the checklist shows the new wording, keeps the answered item's, gains the added item and loses the removed one",
    uploaded && bannerGone &&
      has("E2E unanswered v2") && has("E2E answered") && !text.includes("E2E answered v2") &&
      has("E2E added") && !text.includes("E2E removed") &&
      serverLabels === "E2E added | E2E answered | E2E unanswered v2",
    `uploaded=${uploaded} bannerGone=${bannerGone} server=${serverLabels}`,
  );
  await page.screenshot({ path: `${OUT}/e2e-19-checklist.png`, fullPage: true });
}

// ── 20: editing an item only an out-of-window checklist reads ─────────────
{
  const card = await openTemplate();
  await card.getByRole("button", { name: /^Shed \| / }).click();
  await editLabel(card, "E2E old wording", "E2E new wording");

  // Without the trigger, the delete half of the edit was refused and the old
  // row synced back into the section: two items where there should be one.
  const settled = await until(
    "the edit to upload",
    `select string_agg(label, ' | ' order by label) from checklist_template_items
      where section_id = (select id from checklist_template_sections where template_id = '${templateId}' and name = 'Shed')`,
    "E2E new wording",
  );
  const oldReads = labelsOn(oldId);

  await page.reload({ waitUntil: "domcontentloaded" });
  const again = await openTemplate();
  await again.getByRole("button", { name: /^Shed \| / }).click();
  await again.getByRole("button", { name: "E2E new wording", exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000); // long enough for a refused write's row to sync back
  const shown = {
    old: await again.getByRole("button", { name: "E2E old wording", exact: true }).count(),
    new: await again.getByRole("button", { name: "E2E new wording", exact: true }).count(),
  };
  const discarded = errors.filter((e) => e.includes("Discarding") || e.includes("23503"));
  check(
    "20 the template shows the edited item once, and the 45-day-old checklist still reads its old wording",
    settled && shown.old === 0 && shown.new === 1 && oldReads === "E2E old wording" && discarded.length === 0 &&
      (await page.getByText(BANNER).count()) === 0,
    `settled=${settled} shown=${JSON.stringify(shown)} old=${oldReads} discarded=${discarded.length}`,
  );
  await page.screenshot({ path: `${OUT}/e2e-20-shed.png` });
}

await browser.close();
if (errors.length) console.log("errors:\n  " + errors.join("\n  "));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
