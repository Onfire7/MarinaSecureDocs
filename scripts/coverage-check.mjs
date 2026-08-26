#!/usr/bin/env node
// Fails if any src/lib file sits at zero coverage without an entry in
// docs/testing/coverage-log.md.
//
// The goal isn't a coverage threshold — docs/ROADMAP.md records why a
// threshold during a rewrite is either meaningless or obstructive, and why it
// perversely punishes deleting untested code. The goal is that an untested
// file is a decision somebody wrote down, not something that drifted in.
//
//   pnpm run test:coverage && pnpm run coverage:check

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

let summary;
try {
  summary = JSON.parse(readFileSync(`${root}coverage/coverage-summary.json`, "utf8"));
} catch {
  console.error("No coverage/coverage-summary.json — run `pnpm run test:coverage` first.");
  process.exit(1);
}

const log = readFileSync(`${root}docs/testing/coverage-log.md`, "utf8");

const unlogged = Object.entries(summary)
  .filter(([file]) => file !== "total")
  .filter(([, v]) => v.statements.pct === 0)
  .map(([file]) => file.split("/src/").pop())
  .filter((rel) => !log.includes(rel.split("/").pop()));

if (unlogged.length) {
  console.error(
    "Zero coverage with no entry in docs/testing/coverage-log.md:\n" +
      unlogged.map((f) => `  ${f}`).join("\n") +
      "\n\nAdd each with the reason it isn't tested, or write the test.",
  );
  process.exit(1);
}

const total = summary.total.statements.pct;
console.log(`coverage-check: ok — every zero-coverage file is logged (src/lib total ${total}%)`);
