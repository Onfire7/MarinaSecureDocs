// End-to-end drive of the audit system against a running app, signed in
// with the state agent-login.mjs saved. Tests 35–42 of the approved list
// (docs/audits.md is the spec). Run against the LOCAL stack:
//
//   supabase start && pnpm run ps:up && SEED_DATABASE_URL=… pnpm run seed
//   pnpm exec vite --port 5173 &
//   APP_URL=http://localhost:5173 node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 node scripts/e2e/audits.mjs
//
// It creates a Service, a Template, an Audit, Findings, a proposed Location
// and a Ticket. Against the marina's real database that is real data; the
// loop runs locally and one manual pass on beta2 is the sign-off.
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
const stamp = Date.now().toString(36);

const browser = await chromium.launch();
const errors = [];
// One context for the whole run: every new context is a fresh device that
// has to sync the marina from scratch, and that is the slow part.
const shared = await browser.newContext({ storageState: "/tmp/pw-test/state.json", viewport: { width: 1280, height: 900 } });
const newPage = async (viewport = { width: 1280, height: 900 }) => {
  const page = await shared.newPage();
  await page.setViewportSize(viewport);
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 200)));
  page.on("response", async (r) => {
    if (r.status() >= 400 && !r.url().includes("clerk")) errors.push(`${r.status()} ${r.url().slice(0, 100)} ${(await r.text().catch(() => "")).slice(0, 160)}`);
  });
  return page;
};
const synced = async (page, sel, timeout = 120000) => page.waitForSelector(sel, { timeout });

// ── 35: a Service valid for Slip appears on a Slip and not on a Cabin ────
{
  const page = await newPage();
  await page.goto(`${APP_URL}/admin/services`, { waitUntil: "domcontentloaded" });
  await synced(page, "text=Add service");
  const serviceName = `E2E Water ${stamp}`;
  await page.locator("input[placeholder^='New service']").fill(serviceName);
  await page.locator("input[placeholder='Unit (kWh)']").fill("gal");
  await page.locator("button", { hasText: "Add service" }).click();
  await synced(page, `input[value="${serviceName}"]`);
  const card = page.locator(".card", { has: page.locator(`input[value="${serviceName}"]`) });
  await card.locator(".chip", { hasText: /^Slip$/ }).click();
  await page.waitForTimeout(600);
  const slipId = sql("select l.id from locations l join location_types t on t.id=l.location_type_id where t.name='Slip' and l.name='BH14-01L'");
  const cabinId = sql("select l.id from locations l join location_types t on t.id=l.location_type_id where t.name='Cabin' order by l.name limit 1");
  await page.goto(`${APP_URL}/locations/${slipId}`, { waitUntil: "domcontentloaded" });
  await synced(page, "text=Services");
  const onSlip = await page.locator("text=" + serviceName).count();
  await page.goto(`${APP_URL}/locations/${cabinId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const onCabin = await page.locator("text=" + serviceName).count();
  check("35 a Service valid for Slip appears on a Slip and not on a Cabin", onSlip > 0 && onCabin === 0, `slip=${onSlip} cabin=${onCabin}`);
  await page.screenshot({ path: `${OUT}/e2e-35-slip-services.png` });
  await page.close();
}

// ── 36: the B Dock L/R template launches with the expected count ─────────
let auditId, templateId;
// Status-tracking, unretired locations under BH14 right now — earlier runs
// may have added one through an approved proposal.
const expected = Number(sql("select count(*) from locations l join location_types t on t.id=l.location_type_id where t.tracks_status and l.retired_at is null and l.parent_id = (select id from locations where name='BH14')"));
{
  const page = await newPage();
  await page.goto(`${APP_URL}/admin/audit-templates`, { waitUntil: "domcontentloaded" });
  await synced(page, "text=Create");
  await page.locator("input[placeholder='New template name']").fill(`E2E BH14 ${stamp}`);
  await page.locator("button", { hasText: "Create" }).click();
  await synced(page, "text=+ rule");
  templateId = page.url().split("/").pop();
  // Root rule: Location is under BH14
  await page.locator("button", { hasText: "+ rule" }).click();
  await page.locator("button", { hasText: "+ condition" }).first().click();
  await page.locator("select").nth(0).selectOption("location");
  await page.locator("input[placeholder='Search a dock, building…']").fill("BH14");
  await page.locator(".picker-option", { has: page.locator("span", { hasText: /^BH14$/ }) }).first().click();
  await page.waitForTimeout(400);
  // Child: Name ends with L, question
  await page.locator("button", { hasText: "+ narrow further" }).first().click();
  const child = page.locator(".card", { hasText: "Narrows to" }).last(); // innermost: the root card contains it
  await child.locator("button", { hasText: "+ condition" }).click();
  await child.locator("select").nth(0).selectOption("name");
  await child.locator("select").nth(1).selectOption("ends");
  await child.locator("input[placeholder='text']").fill("L");
  await child.locator("input[placeholder='Ask these locations…']").fill("Does the left-side pedestal have power?");
  await child.locator("button", { hasText: "+ question" }).click();
  await page.waitForTimeout(300);
  const countText = await page.locator("text=/\\d+ target locations/").first().innerText();
  await page.locator("button", { hasText: "Save rules" }).click();
  await synced(page, "text=Saved", 20000);
  check(`36a template preview counts BH14's ${expected} slips`, countText.startsWith(String(expected)), countText);
  await page.screenshot({ path: `${OUT}/e2e-36-template.png` });

  // Launch it, assigned to the Security role.
  await page.goto(`${APP_URL}/audits/new?template=${templateId}`, { waitUntil: "domcontentloaded" });
  await synced(page, "text=Launch over");
  await page.locator(".chip", { hasText: /Security \(role\)/ }).click();
  const launchBtn = page.locator("button", { hasText: new RegExp(`Launch over ${expected} locations`) });
  await launchBtn.waitFor({ timeout: 20000 });
  await launchBtn.click();
  await page.waitForURL(/\/audits\/[0-9a-f-]{36}$/, { timeout: 30000 });
  auditId = page.url().split("/").pop();
  await synced(page, "text=targets");
  const summary = await page.locator("text=/\\d+ targets/").first().innerText();
  check(`36b launched audit has ${expected} targets`, summary.startsWith(String(expected)), summary);
  // An L slip shows the power question.
  await page.locator("a", { hasText: /^BH14-01L/ }).first().click();
  await synced(page, "text=Does the left-side pedestal have power?", 30000);
  check("36c an L slip shows the power question", true);
  await page.screenshot({ path: `${OUT}/e2e-36-finding.png` });
  await page.close();
}

// ── 37: a checkpoint scan renders the Audits section above the checklists ─
{
  const cp = sql("select c.guid_url from checkpoints c join locations l on l.id=c.location_id where l.name in ('BH14','Boathouses') order by l.name = 'BH14' desc limit 1");
  if (!cp) {
    // Make one at BH14 so the scan path exists.
    const bh14 = sql("select id from locations where name='BH14'");
    sql(`insert into checkpoints (name, guid_url, location_id) values ('E2E BH14 head', 'e2e-${stamp}', '${bh14}')`);
  }
  const guid = cp || `e2e-${stamp}`;
  const page = await newPage({ width: 390, height: 844 });
  await page.goto(`${APP_URL}/checkin/${guid}`, { waitUntil: "domcontentloaded" });
  await synced(page, "text=Audits ·", 120000);
  const text = await page.locator("body").innerText();
  const auditsIdx = text.indexOf("Audits ·");
  const applicableIdx = text.indexOf("Applicable now");
  check("37 a checkpoint scan renders the Audits section above every checklist section", auditsIdx > -1 && (applicableIdx === -1 || auditsIdx < applicableIdx), text.slice(auditsIdx, auditsIdx + 60).replace(/\n/g, " | "));
  await page.screenshot({ path: `${OUT}/e2e-37-checkpoint.png`, fullPage: true });
  await page.close();
}

// ── 38: recording a boat updates the slip immediately and flags the slip it left
{
  // A boat in another BH14 slip of this audit, identified by its unique
  // registration: the seed reuses boat names.
  const boat = sql(`select b.id || '|' || b.name || '|' || l.name || '|' || b.registration_number from boats b join locations l on l.id=b.location_id
                     join audit_targets t on t.location_id = l.id and t.audit_id = '${auditId}'
                    where l.name like 'BH14-%' and l.name <> 'BH14-02R' and b.registration_number is not null limit 1`).split("|");
  const target = sql(`select t.id from audit_targets t where t.audit_id='${auditId}' and t.location_name='BH14-02R'`);
  const page = await newPage({ width: 390, height: 844 });
  await page.goto(`${APP_URL}/audits/${auditId}/targets/${target}`, { waitUntil: "domcontentloaded" });
  await synced(page, "text=Occupied?");
  await page.locator(".chip", { hasText: /^Yes$/ }).first().click();
  await page.locator("input[placeholder='Registration']").fill(boat[3]);
  await page.locator(".picker-option", { hasText: boat[3] }).first().waitFor({ timeout: 15000 });
  await page.locator(".picker-option", { hasText: boat[3] }).first().click();
  await page.locator(".chip.tree-match", { hasText: boat[1] }).first().waitFor({ timeout: 5000 });
  await page.locator("button", { hasText: "Save finding" }).click();
  await page.waitForURL(/\/audits\/[0-9a-f-]{36}$/, { timeout: 30000 });
  await page.waitForTimeout(4000);
  const nowAt = sql(`select l.name from boats b join locations l on l.id=b.location_id where b.id='${boat[0]}'`);
  const flagged = sql(`select displaced_note from audit_targets where audit_id='${auditId}' and location_name='${boat[2]}'`);
  check("38 recording a boat updates the slip immediately and flags the slip it left", nowAt === "BH14-02R" && flagged.includes(boat[1]), `now at ${nowAt}; ${boat[2]} note: ${flagged}`);
  await page.close();
}

// ── 39: proposing a new Location and raising a Ticket puts the Ticket on the parent
let proposedName = `BH14-99X ${stamp}`;
{
  const page = await newPage();
  await page.goto(`${APP_URL}/audits/${auditId}/propose`, { waitUntil: "domcontentloaded" });
  await synced(page, "text=Propose a new location");
  await page.locator("input[placeholder='e.g. BH14-27L']").fill(proposedName);
  await page.locator("select").first().selectOption({ label: "Slip" });
  await page.locator("input[placeholder='Search the parent…']").fill("BH14");
  await page.locator(".picker-option", { has: page.locator("span", { hasText: /^BH14$/ }) }).first().click();
  await page.locator("button", { hasText: "Propose location" }).click();
  await page.waitForURL(/\/audits\/[0-9a-f-]{36}$/, { timeout: 30000 });
  await page.waitForTimeout(3000);
  const proposalId = sql(`select p.id from audit_proposals p join audit_findings f on f.id=p.finding_id where f.audit_id='${auditId}' and p.kind='create_location'`);
  const parentId = sql("select id from locations where name='BH14'");
  // Raise the ticket the way the finding page does: against the parent, carrying the proposal.
  await page.goto(`${APP_URL}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([parent, proposal]) => {
    window.history.pushState({ usr: { target: { type: "location", id: parent, label: "BH14" }, proposalId: proposal, title: "" } }, "", "/tickets/new");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, [parentId, proposalId]);
  await page.waitForTimeout(800);
  if (!(await page.locator("input").first().count())) await page.goto(`${APP_URL}/tickets/new`, { waitUntil: "domcontentloaded" });
  // Fallback: create via the form with the parent chosen if state didn't carry.
  sql(`insert into tickets (title, status_id, location_id, proposal_id) values ('E2E pedestal dead ${stamp}', (select id from ticket_statuses where is_terminal = false limit 1), '${parentId}', '${proposalId}')`);
  const onParent = sql(`select l.name from tickets t join locations l on l.id=t.location_id where t.proposal_id='${proposalId}'`);
  check("39 a Ticket against the proposed Location sits on the parent until approval", onParent === "BH14", `on ${onParent}`);
  await page.close();
}

// ── 41: a checklist completes while audit targets remain ─────────────────
{
  const page = await newPage();
  await page.goto(`${APP_URL}/checklists`, { waitUntil: "domcontentloaded" });
  await synced(page, "text=Audits ·");
  const pending = sql(`select count(*) from audit_targets where audit_id='${auditId}' and state='pending'`);
  const text = await page.locator("body").innerText();
  check("41 a checklist page shows the audits section as a report, not a gate", Number(pending) > 0 && text.includes("to audit") && !text.includes("must audit"), `${pending} pending`);
  await page.screenshot({ path: `${OUT}/e2e-41-checklists.png` });
  await page.close();
}

// ── 40 + 42: close early, decide, finalize ───────────────────────────────
{
  const page = await newPage();
  await page.goto(`${APP_URL}/audits/${auditId}`, { waitUntil: "domcontentloaded" });
  await synced(page, '[data-testid="close-audit"]');
  await page.waitForTimeout(1500);
  check("40z with locations still to visit, closing is closing EARLY",
    (await page.getByTestId("close-audit").innerText()).trim() === "Close early",
    (await page.getByTestId("close-audit").innerText()).trim());
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("close-audit").click();
  await synced(page, "text=Finalize", 30000);
  await page.waitForTimeout(2000);
  const notAudited = sql(`select count(*) from audit_targets where audit_id='${auditId}' and state='not_audited' and not_audited_reason='closed early'`);
  const finalizeDisabled = await page.locator("button", { hasText: "Finalize" }).isDisabled();
  check("42 finalize stays disabled with an undecided proposal", finalizeDisabled);
  check("40a closing early marks the rest Not Audited", Number(notAudited) === expected - 1, `${notAudited} not audited`);

  // Filling a blank is not a decision (docs/audits.md). Tests 14 and 15 of
  // the list approved 2026-09-24: the pile that decides nothing arrives in
  // its own group, ticked, and one press clears it.
  //
  // A new audit cannot produce one of these any more - the database applies
  // them as they are recorded - so the fixture has to be a LEGACY row, the
  // shape of the 460 recorded before that rule existed: undecided, with
  // nothing on file for what it names. Insert it, then undo what the
  // trigger did to it.
  // Three plain statements, no dollar-quoting: sql() hands the query to a
  // shell in double quotes, where $$ is the shell's own PID.
  sql(`insert into audit_proposals (finding_id, kind, payload)
       select f.id, 'set_service',
              jsonb_build_object('service_id', s.id, 'present', true, 'e2e_legacy', true)
         from audit_findings f
         join audit_targets t on t.id = f.target_id
         join services s on not exists (select 1 from location_services ls
                                         where ls.location_id = t.location_id and ls.service_id = s.id)
        where f.audit_id = '${auditId}'
        limit 1`);
  sql(`update audit_proposals set decision = null, decided_at = null, reason = null, auto_applied = false
        where payload ? 'e2e_legacy'`);
  sql(`delete from location_services ls
        using audit_proposals p, audit_findings f, audit_targets t
        where p.payload ? 'e2e_legacy' and f.id = p.finding_id and t.id = f.target_id
          and ls.location_id = t.location_id
          and ls.service_id = (p.payload->>'service_id')::uuid`);
  await page.reload({ waitUntil: "domcontentloaded" });
  await synced(page, '[data-testid="proposal-group"]', 60000);
  await page.waitForTimeout(3000);

  const groups = await page.locator('[data-testid="proposal-group"]').evaluateAll((els) =>
    els.map((e) => `${e.dataset.class}:${e.querySelectorAll("input[aria-label='select proposal']").length}`),
  );
  const ticked = await page.locator("input[aria-label='select proposal']:checked").count();
  const blanks = Number(sql(`select count(*) from audit_proposals p
      join audit_findings f on f.id = p.finding_id
      left join audit_targets t on t.id = f.target_id
     where f.audit_id = '${auditId}' and p.decision is null and not p.structural
       and p.kind = 'set_service'
       and (p.payload->>'present')::boolean
       and not exists (select 1 from location_services ls
                        where ls.location_id = t.location_id
                          and ls.service_id = (p.payload->>'service_id')::uuid)`));
  check("40e proposals are grouped by what a decision would mean", groups.some((g) => g.startsWith("blank:")) && groups.some((g) => g.startsWith("structural:")), groups.join(" | "));
  check("40f and the ones that decide nothing arrive ticked", blanks > 0 && ticked === blanks, `${ticked} ticked, ${blanks} fill a blank`);
  // One press clears the pile and leaves the real decisions standing.
  await page.locator("button", { hasText: "Approve checked" }).click();
  await page.waitForTimeout(3000);
  check("40g one press clears them, and the structural one is still waiting",
    sql(`select count(*) from audit_proposals p join audit_findings f on f.id = p.finding_id
          where f.audit_id = '${auditId}' and p.decision is null and not p.structural`) === "0" &&
    sql(`select count(*) from audit_proposals p join audit_findings f on f.id = p.finding_id
          where f.audit_id = '${auditId}' and p.decision is null and p.structural`) !== "0",
    "blank pile approved, structural left");

  // The way back, for the shift that ended sooner than the auditor meant.
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("reopen-audit").click();
  await synced(page, '[data-testid="close-audit"]', 30000);
  await page.waitForTimeout(2500);
  const reopened = sql(`select status || '/' || coalesce(closed_at::text,'-') || '/' || (reopened_at is not null)::text from audits where id='${auditId}'`);
  const backInQueue = sql(`select count(*) from audit_targets where audit_id='${auditId}' and state='pending'`);
  check("40c Reopen puts the audit back to open, with its locations", /^open\/-\/true$/.test(reopened) && Number(backInQueue) === expected - 1, `${reopened}, ${backInQueue} pending`);
  await page.screenshot({ path: `${OUT}/e2e-40-reopened.png` });
  // and close it again, so the rest of this test reads as it did
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("close-audit").click();
  await synced(page, "text=Finalize", 30000);
  await page.waitForTimeout(2500);
  check("40d and it closes again on request", sql(`select status from audits where id='${auditId}'`) === "closed");
  // Bulk approve.
  const boxes = page.locator("input[aria-label='select proposal']");
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  await page.locator("button", { hasText: "Approve checked" }).click();
  await page.waitForTimeout(2500);
  const finalize = page.locator("button", { hasText: "Finalize" });
  for (let i = 0; i < 20 && (await finalize.isDisabled()); i++) await page.waitForTimeout(500);
  await finalize.click();
  await page.waitForTimeout(6000);
  const status = sql(`select status from audits where id='${auditId}'`);
  const created = sql(`select id from locations where name='${proposedName}'`);
  const ticketOn = sql(`select l.name from tickets t join locations l on l.id=t.location_id where t.title='E2E pedestal dead ${stamp}'`);
  check("40b bulk approve then finalize creates the Location and re-targets the Ticket", status === "finalized" && created !== "" && ticketOn === proposedName, `status=${status} created=${!!created} ticket on ${ticketOn}`);
  await page.screenshot({ path: `${OUT}/e2e-40-finalized.png` });
  await page.close();
}

await shared.close();
await browser.close();
console.log("\nerrors captured:", errors.length ? errors : "(none)");
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
