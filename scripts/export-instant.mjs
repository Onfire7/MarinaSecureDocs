#!/usr/bin/env node
// Full export of this marina's InstantDB contents to migration/instant-export/,
// one JSON file per entity plus a manifest.
//
// Why this exists: InstantDB is being retired (service ends 2027-08-31) and
// the app is migrating to Supabase + PowerSync. This is the source side of
// that migration's export → transform → load pipeline, and it runs more than
// once — to seed development, and again at production cutover. The output is
// gitignored: it contains guest contact details, and a populated marina turns
// over thousands of contacts a year. Regenerate it rather than sharing it.
//
// Why it drives a browser instead of using @instantdb/admin: the admin token
// isn't in .env.local, only CLERK_SECRET_KEY. So the export runs inside a real
// signed-in session (scripts/agent-login.mjs first), which means it sees
// exactly what the permission rules allow that user to see — honest, but *not*
// necessarily complete. If INSTANT_APP_ADMIN_TOKEN is ever added, prefer
// scripts/instant-admin.mjs: it bypasses the rules and is the only way to be
// certain nothing is withheld.
//
//   node scripts/agent-login.mjs        # once, to mint the session
//   node scripts/export-instant.mjs
//
// Links are exported as id references on both sides of every relationship, so
// the transform step can rebuild them as foreign keys without re-querying.

import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const env = loadEnv();
const APP_URL = env.APP_URL ?? "https://beta.marinasecure.com";
const APP_ID = env.VITE_INSTANT_APP_ID;
const CLERK_CLIENT = env.VITE_INSTANT_CLERK_CLIENT_NAME ?? "clerk";
const STATE_FILE = env.STATE_FILE ?? "/tmp/pw-test/state.json";
const OUT = `${repoRoot}migration/instant-export`;

if (!APP_ID) {
  console.error("Need VITE_INSTANT_APP_ID in .env.local");
  process.exit(1);
}

// Entities and links are read from instant.schema.ts rather than hardcoded, so
// the export cannot silently miss a namespace added after this was written.
const src = readFileSync(`${repoRoot}instant.schema.ts`, "utf8");
const entities = [...src.matchAll(/^\s{4}([\w$]+): i\.entity\(/gm)].map((m) => m[1]);
const linkRe =
  /forward:\s*\{\s*on:\s*"([\w$]+)",\s*has:\s*"\w+",\s*label:\s*"(\w+)"\s*\},\s*reverse:\s*\{\s*on:\s*"([\w$]+)",\s*has:\s*"\w+",\s*label:\s*"(\w+)"\s*\}/g;
const linksByEntity = Object.fromEntries(entities.map((e) => [e, new Set()]));
let match;
let linkCount = 0;
while ((match = linkRe.exec(src))) {
  const [, forwardOn, forwardLabel, reverseOn, reverseLabel] = match;
  linksByEntity[forwardOn]?.add(forwardLabel);
  linksByEntity[reverseOn]?.add(reverseLabel);
  linkCount++;
}
if (!entities.length || !linkCount) {
  console.error("Parsed 0 entities or 0 links from instant.schema.ts — the file's shape changed.");
  process.exit(1);
}
console.log(`schema: ${entities.length} entities, ${linkCount} links`);

const queries = Object.fromEntries(
  entities.map((e) => [
    e,
    { [e]: Object.fromEntries([...linksByEntity[e]].map((l) => [l, { $: { fields: ["id"] } }])) },
  ]),
);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({ storageState: STATE_FILE });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Clerk?.session, { timeout: 30000 });

const { rows, errors } = await page.evaluate(
  async ({ appId, clerkClient, queries }) => {
    const { init } = await import("https://esm.sh/@instantdb/core@1.0.49");
    // getToken() with no template — matches InstantAuthSync.tsx; the Clerk app
    // has no JWT template registered under the Instant client name.
    const idToken = await window.Clerk.session.getToken();
    const db = init({ appId });
    await db.auth.signInWithIdToken({ clientName: clerkClient, idToken });
    const rows = {};
    const errors = {};
    for (const [name, query] of Object.entries(queries)) {
      try {
        const result = await db.queryOnce(query);
        rows[name] = result?.data?.[name] ?? [];
      } catch (e) {
        errors[name] = (e?.message ?? String(e)).slice(0, 200);
        rows[name] = [];
      }
    }
    return { rows, errors };
  },
  { appId: APP_ID, clerkClient: CLERK_CLIENT, queries },
);
await browser.close();

mkdirSync(OUT, { recursive: true });
const manifest = {};
for (const [name, entityRows] of Object.entries(rows)) {
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(entityRows, null, 2));
  manifest[name] = { rows: entityRows.length, links: [...linksByEntity[name]] };
}
writeFileSync(
  `${OUT}/_manifest.json`,
  JSON.stringify(
    {
      source: "InstantDB",
      appId: APP_ID,
      appUrl: APP_URL,
      exportedVia: "signed-in browser session — permission rules applied, not an admin-token bypass",
      entities: manifest,
    },
    null,
    2,
  ),
);

const populated = Object.entries(manifest).filter(([, v]) => v.rows > 0);
console.log(`wrote ${Object.keys(manifest).length} files to migration/instant-export/`);
console.log(`populated: ${populated.length}, total rows: ${populated.reduce((s, [, v]) => s + v.rows, 0)}`);
if (Object.keys(errors).length) {
  console.log("ERRORS:", JSON.stringify(errors, null, 2));
  process.exit(1);
}
