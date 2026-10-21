// End-to-end drive of "Copy to locations…" on the template builder
// (src/pages/admin/AdminChecklistTemplatesPage.spec.md § Copy a section to
// locations), tests 11 and 12 of the approved list. Run against the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   psql "$DB" -f scripts/e2e/seed-copy-section.sql
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/copy-section.mjs
//
// It adds sections and checkpoints. Re-seed before each run.
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

const templateId = sql(`select id from checklist_templates where name = 'Copy e2e'`);
if (!templateId || sql(`select count(*) from checklist_template_sections where template_id = '${templateId}'`) !== "2") {
  console.error("Seed first: psql -f scripts/e2e/seed-copy-section.sql");
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
page.on("console", (m) => {
  if (m.type() === "error" || m.text().includes("Discarding")) errors.push("console: " + m.text().slice(0, 200));
});
page.on("response", async (r) => {
  if (r.status() >= 400 && !r.url().includes("clerk")) errors.push(`${r.status()} ${r.url().slice(0, 100)} ${(await r.text().catch(() => "")).slice(0, 160)}`);
});

async function openDialog() {
  await page.goto(`${APP_URL}/admin/checklist-templates`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Copy e2e", exact: true }).click({ timeout: 120000 });
  const card = page.locator(".card", { has: page.locator('input[aria-label="Template name"][value="Copy e2e"]') });
  await card.waitFor();
  await card.getByRole("button", { name: /^Copy Slip 1 e2e walk \| / }).click();
  await card.getByRole("button", { name: "Copy to locations…" }).click();
  const dialog = page.getByRole("dialog", { name: /Copy “Copy Slip 1 e2e walk” to locations/ });
  await dialog.waitFor();
  // Under: the dock. The picker is a search box; type and take the match.
  await dialog.getByPlaceholder("Anywhere").fill("Copy Dock e2e");
  await page.locator(".picker-option", { hasText: "Copy Dock e2e" }).first().click();
  await dialog.getByRole("checkbox", { name: /Copy Slip 2 e2e/ }).waitFor();
  return dialog;
}

// ── 11: the dialog creates the sections ───────────────────────────────────
{
  const dialog = await openDialog();
  const slip4 = dialog.getByRole("checkbox", { name: /Copy Slip 4 e2e/ });
  const slip1Offered = await dialog.getByRole("checkbox", { name: /Copy Slip 1 e2e/ }).count();
  await dialog.getByRole("button", { name: "Select all" }).click();
  await dialog.getByRole("radio", { name: /Create matching checkpoints/ }).check();
  await page.screenshot({ path: `${OUT}/e2e-11-dialog.png` });
  const submit = dialog.getByRole("button", { name: /^Add \d+ sections?$/ });
  const submitLabel = await submit.innerText();
  await submit.click();
  await dialog.waitFor({ state: "hidden" });

  const uploaded = await until(
    "the sections to upload",
    `select count(*) from checklist_template_sections where template_id = '${templateId}'`,
    "4",
  );
  const names = sql(`select string_agg(name, ' | ' order by position) from checklist_template_sections where template_id = '${templateId}'`);
  const items = sql(`select string_agg(ti.label || ':' || coalesce((ti.config->>'locationId' = s.location_id::text)::text, '-'), ' | ' order by s.position, ti.position)
                       from checklist_template_items ti join checklist_template_sections s on s.id = ti.section_id
                      where s.template_id = '${templateId}' and s.name like 'Copy Slip _ e2e walk' and s.name <> 'Copy Slip 1 e2e walk'`);
  const cps = sql(`select string_agg(c.name || '@' || l.name || ':' || c.gps_validation_radius || ':' || (c.guid_url <> 'copy-slip-1-e2e')::text, ' | ' order by c.name)
                     from template_section_checkpoints sc join checkpoints c on c.id = sc.checkpoint_id
                     join locations l on l.id = c.location_id join checklist_template_sections s on s.id = sc.section_id
                    where s.template_id = '${templateId}' and s.name <> 'Copy Slip 1 e2e walk'`);
  await page.screenshot({ path: `${OUT}/e2e-11-after.png` });
  check(
    "11 two sections, not three, named for their slips, with repointed items and matching checkpoints",
    uploaded && slip1Offered === 0 && (await slip4.isDisabled()) && submitLabel === "Add 2 sections" &&
      names === "Copy Slip 1 e2e walk | Copy Slip 2 e2e walk | Copy Slip 3 e2e walk | Slip 4" &&
      items === "Copy Slip 2 e2e door:true | Copy Slip 2 e2e gate:- | Copy Slip 3 e2e door:true | Copy Slip 3 e2e gate:-" &&
      cps === "Copy Slip 2 e2e gate tag@Copy Slip 2 e2e:25:true | Copy Slip 3 e2e gate tag@Copy Slip 3 e2e:25:true",
    `uploaded=${uploaded} label=${submitLabel} names=${names} items=${items} cps=${cps}`,
  );
}

// ── 12: running it again adds nothing ─────────────────────────────────────
{
  await page.reload({ waitUntil: "domcontentloaded" });
  const dialog = await openDialog();
  const boxes = dialog.getByRole("checkbox");
  const n = await boxes.count();
  let disabled = 0;
  for (let i = 0; i < n; i++) if (await boxes.nth(i).isDisabled()) disabled++;
  const submitDisabled = await dialog.getByRole("button", { name: /^Add \d+ sections?$/ }).isDisabled();
  await page.screenshot({ path: `${OUT}/e2e-12-again.png` });
  check(
    "12 every slip is shown ticked and disabled, nothing can be added, and the count is unchanged",
    n === 3 && disabled === 3 && submitDisabled &&
      sql(`select count(*) from checklist_template_sections where template_id = '${templateId}'`) === "4",
    `boxes=${n} disabled=${disabled} submitDisabled=${submitDisabled}`,
  );
}

await browser.close();
if (errors.length) console.log("errors:\n  " + errors.join("\n  "));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
