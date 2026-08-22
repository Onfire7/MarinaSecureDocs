#!/usr/bin/env node
// Direct InstantDB access for agent/admin tooling, via @instantdb/admin.
//
// Needs INSTANT_APP_ADMIN_TOKEN in .env.local (Instant dashboard → the app →
// Admin token). The admin token bypasses permission rules entirely, which is
// also what makes impersonation the honest way to *test* those rules: --as
// scopes every query through the rule engine as that user, --guest as an
// anonymous client.
//
//   node scripts/instant-admin.mjs query '{"users":{"roles":{}}}'
//   node scripts/instant-admin.mjs query '{"roles":{}}' --as gpp@onfire.us
//   node scripts/instant-admin.mjs query '{"users":{}}' --guest
//   node scripts/instant-admin.mjs transact '[
//     {"op":"update","ns":"roles","id":"<uuid>","data":{"allow":["manage_roles"]}},
//     {"op":"link","ns":"users","id":"<uuid>","links":{"roles":"<uuid>"}}
//   ]'
//
// transact ops: update (create-or-merge), link, unlink, delete — the same
// four primitives db.tx exposes.

import { init, tx, id } from "@instantdb/admin";
import { loadEnv } from "./env.mjs";

const env = loadEnv();
const appId = env.VITE_INSTANT_APP_ID;
const adminToken = env.INSTANT_APP_ADMIN_TOKEN;
if (!appId || !adminToken) {
  console.error(
    "Need VITE_INSTANT_APP_ID and INSTANT_APP_ADMIN_TOKEN in .env.local " +
      "(admin token: Instant dashboard → app → Admin token).",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const command = args[0];
const asIdx = args.indexOf("--as");
const impersonateEmail = asIdx !== -1 ? args[asIdx + 1] : null;
const asGuest = args.includes("--guest");

let db = init({ appId, adminToken });
if (impersonateEmail) db = db.asUser({ email: impersonateEmail });
else if (asGuest) db = db.asUser({ guest: true });

if (command === "query") {
  const q = JSON.parse(args[1]);
  try {
    const data = await db.query(q);
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("QUERY FAILED:", e?.body?.message ?? e?.message ?? e);
    process.exit(1);
  }
} else if (command === "transact") {
  const steps = JSON.parse(args[1]);
  const chunks = steps.map((s) => {
    const chunk = tx[s.ns][s.id === "new" ? id() : s.id];
    if (s.op === "update") return chunk.update(s.data ?? {});
    if (s.op === "link") return chunk.link(s.links);
    if (s.op === "unlink") return chunk.unlink(s.links);
    if (s.op === "delete") return chunk.delete();
    throw new Error(`Unknown op: ${s.op}`);
  });
  try {
    const res = await db.transact(chunks);
    console.log("OK tx-id:", res["tx-id"]);
  } catch (e) {
    console.error("TRANSACT FAILED:", e?.body?.message ?? e?.message ?? e);
    process.exit(1);
  }
} else {
  console.error("Usage: instant-admin.mjs query|transact <json> [--as email] [--guest]");
  process.exit(1);
}
