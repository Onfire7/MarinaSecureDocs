#!/usr/bin/env node
// Puts PowerSync's SQLite worker and WASM where the browser can fetch them,
// then removes the builds this app cannot load.
//
// `powersync-web copy-assets` ships four WASM builds — {plain, multi-cipher} ×
// {sync, async} — totalling 7.2 MB. Exactly one is reachable from any given
// configuration, and ours resolves to the plain async build: the default
// IDBBatchAtomicVFS is asynchronous, and no `encryptionKey` is passed to
// PowerSyncDatabase, which is what selects the mc- (multi-cipher) variants.
//
// Deleting the other three is not tidiness. Everything under public/ that the
// precache glob matches is downloaded by the service worker on first load, so
// leaving them costs a marina phone 5 MB of WASM it will never execute —
// against an app whose entire purpose is working where the signal is bad.
//
// If the VFS or encryption settings in src/lib/db/index.ts ever change, the
// KEEP pattern below changes with them, and the symptom of getting it wrong is
// loud: the database fails to open.
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const ASSETS = "public/@powersync/assets";
const KEEP = /^wa-sqlite-async-.*\.wasm$/;

execFileSync("node_modules/.bin/powersync-web", ["copy-assets"], {
  stdio: "inherit",
});

let freed = 0;
for (const name of readdirSync(ASSETS)) {
  if (!name.endsWith(".wasm") || KEEP.test(name)) continue;
  const path = join(ASSETS, name);
  freed += statSync(path).size;
  rmSync(path);
}

const kept = readdirSync(ASSETS).filter((n) => n.endsWith(".wasm"));
if (kept.length !== 1) {
  console.error(
    `Expected exactly one WASM build to survive, found ${kept.length}: ${kept.join(", ")}.\n` +
      "The upstream asset names changed — update KEEP in this script.",
  );
  process.exit(1);
}
console.log(
  `kept ${kept[0]}, pruned ${(freed / 1024 / 1024).toFixed(1)} MB of unreachable WASM`,
);
