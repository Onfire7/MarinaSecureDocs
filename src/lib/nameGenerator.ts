/**
 * Composes a name list from prefix(es) + a counter + suffix(es) — e.g.
 * "BH-A-" × 5…10 × "L,R" gives BH-A-5L … BH-A-10R.
 *
 * Extracted from the create-locations dialog so the setup wizard can share
 * exactly the same semantics: one pattern that means the same thing in both
 * places is the difference between a wizard that's predictable and one whose
 * output you have to check every time.
 */

export type CounterMode = "number" | "letter" | "none";

export interface GeneratorOptions {
  prefixes: string;
  suffixes: string;
  mode: CounterMode;
  start: string;
  end: string;
  step: number;
  pad: number;
}

export const DEFAULT_GENERATOR: GeneratorOptions = {
  prefixes: "",
  suffixes: "",
  mode: "number",
  start: "1",
  end: "10",
  step: 1,
  pad: 0,
};

/** Comma-separated variants; an empty field contributes one empty variant. */
export function splitList(raw: string): string[] {
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts.length > 0 ? parts : [""];
}

export function counterValues(o: GeneratorOptions): string[] {
  if (o.mode === "none") return [""];
  const step = Math.max(1, o.step);

  if (o.mode === "letter") {
    const a = (o.start || "A").toUpperCase().charCodeAt(0);
    const b = (o.end || "A").toUpperCase().charCodeAt(0);
    if (Number.isNaN(a) || Number.isNaN(b)) return [];
    const dir = b >= a ? 1 : -1;
    const out: string[] = [];
    for (let c = a; dir > 0 ? c <= b : c >= b; c += dir * step) {
      out.push(String.fromCharCode(c));
    }
    return out;
  }

  const a = Number(o.start);
  const b = Number(o.end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [];
  const dir = b >= a ? 1 : -1;
  const out: string[] = [];
  for (let n = a; dir > 0 ? n <= b : n >= b; n += dir * step) {
    out.push(String(Math.abs(n)).padStart(o.pad, "0"));
    // A wide range would otherwise be easy to fat-finger into a hang.
    if (out.length >= 2000) break;
  }
  return out;
}

/**
 * Resolves the parent-referencing tokens that let ONE pattern cover many
 * containers whose names differ.
 *
 * This is the whole reason the wizard can express "every dock gets slips
 * named after it" without a separate pattern per dock: `{parent.last}` on
 * "Dock A" yields "A", so a shared prefix of `{parent.last}` produces A1…
 * under Dock A and B1… under Dock B. Only the counts then differ, and a
 * count is one number per row.
 */
export function resolveTokens(text: string, parentName: string): string {
  const words = parentName.trim().split(/\s+/).filter(Boolean);
  const last = words.length > 0 ? words[words.length - 1] : parentName;
  const initials = words.map((w) => w[0] ?? "").join("");
  return text
    .replaceAll("{parent.last}", last)
    .replaceAll("{parent.initials}", initials)
    .replaceAll("{parent}", parentName.trim());
}

export const TOKEN_HINT =
  "{parent} the container's name · {parent.last} its last word (Dock A → A) · {parent.initials} (Dock A → DA)";

/**
 * @param parentName when given, tokens in prefix/suffix resolve against it.
 */
export function generateNames(o: GeneratorOptions, parentName?: string): string[] {
  const out: string[] = [];
  const resolve = (s: string) =>
    parentName == null ? s : resolveTokens(s, parentName);
  for (const prefix of splitList(o.prefixes)) {
    for (const counter of counterValues(o)) {
      for (const suffix of splitList(o.suffixes)) {
        const name = `${resolve(prefix)}${counter}${resolve(suffix)}`;
        if (name.length > 0) out.push(name);
      }
    }
  }
  return out;
}
