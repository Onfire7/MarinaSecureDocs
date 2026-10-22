// Compares two i18n-coverage.mjs snapshots (SNAPSHOT=…) page by page, and
// prints where the English differs. Proves a catalog conversion changed no
// wording (docs/localization.md § Keys mode).
//
// Text nodes are compared as one whitespace-free stream per page, because a
// conversion legitimately merges nodes: `Notes ({notes.length})` renders
// three nodes, `t("notes", { count })` one. Neither run's live values (the
// clock, a shift's duration) are stable, so a difference is a lead to read,
// not automatically a regression.
//
//   node scripts/e2e/i18n-snapshot-diff.mjs before.json after.json
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, "utf8")).routes);
const stream = (texts) => texts.join("").replace(/\s+/g, "");
const CONTEXT = 50;

let same = 0;
const differ = [];
for (const path of Object.keys(a)) {
  if (!(path in b)) {
    differ.push(`${path}: missing from the second snapshot`);
    continue;
  }
  const x = stream(a[path]);
  const y = stream(b[path]);
  if (x === y) {
    same++;
    continue;
  }
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  let j = 0;
  while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  differ.push(
    `${path}\n  before: …${x.slice(Math.max(0, i - CONTEXT), x.length - j + CONTEXT)}…\n  after:  …${y.slice(Math.max(0, i - CONTEXT), y.length - j + CONTEXT)}…`,
  );
}
console.log(`${same} pages identical, ${differ.length} differ.\n`);
console.log(differ.join("\n\n"));
process.exit(differ.length ? 1 : 0);
