import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Reads .env.local at the repo root and returns it merged under process.env
// (process.env wins). The agent scripts run outside Vite, so they can't rely
// on import.meta.env — and adding a dotenv dependency for a 10-line parse
// isn't worth it.
export function loadEnv() {
  const path = fileURLToPath(new URL("../.env.local", import.meta.url));
  let fileVars = {};
  try {
    fileVars = Object.fromEntries(
      readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => [
          l.slice(0, l.indexOf("=")).trim(),
          l.slice(l.indexOf("=") + 1).trim(),
        ]),
    );
  } catch {
    // No .env.local (e.g. CI) — env vars must come from the environment.
  }
  return { ...fileVars, ...process.env };
}
