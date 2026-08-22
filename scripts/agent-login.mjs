#!/usr/bin/env node
// Signs into the app without the interactive Clerk UI, for agent/E2E testing.
//
// Uses Clerk's Backend API (CLERK_SECRET_KEY from .env.local) to mint a
// single-use sign-in token for an existing Clerk user, then drives a headless
// browser through the ticket-strategy sign-in on the deployed app. On success
// the browser storage state is saved so later scripts can start already
// signed in, and the script reports which of the app's post-auth screens
// actually rendered — dashboard, "Can't reach the marina database" (Instant
// origin/config failure), or "Unable to sign in" (unprovisioned account).
//
//   node scripts/agent-login.mjs
//   APP_URL=http://localhost:5173 LOGIN_EMAIL=someone@example.com \
//     node scripts/agent-login.mjs
//
// The sign-in token is single-use and expires in 10 minutes; no passwords
// are involved or changed.

import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { loadEnv } from "./env.mjs";

const env = loadEnv();
const APP_URL = env.APP_URL ?? "https://beta.marinasecure.com";
const EMAIL = env.LOGIN_EMAIL ?? "gpp@onfire.us";
const STATE_FILE = env.STATE_FILE ?? "/tmp/pw-test/state.json";
const SECRET = env.CLERK_SECRET_KEY;
if (!SECRET) {
  console.error("CLERK_SECRET_KEY not found in .env.local or environment");
  process.exit(1);
}

async function clerkApi(path, opts = {}) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${SECRET}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Clerk ${path} failed: ${JSON.stringify(body.errors ?? body)}`);
  }
  return body;
}

const users = await clerkApi(
  `/users?email_address=${encodeURIComponent(EMAIL)}`,
);
if (!users.length) {
  console.error(`No Clerk user exists for ${EMAIL}`);
  process.exit(1);
}
const { token } = await clerkApi("/sign_in_tokens", {
  method: "POST",
  body: JSON.stringify({ user_id: users[0].id, expires_in_seconds: 600 }),
});
console.log(`Minted sign-in token for ${EMAIL} (${users[0].id})`);

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("CONSOLE: " + m.text().slice(0, 200));
});

await page.goto(`${APP_URL}/sign-in`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Clerk?.loaded, { timeout: 30000 });

const signIn = await page.evaluate(async (ticket) => {
  try {
    const res = await window.Clerk.client.signIn.create({
      strategy: "ticket",
      ticket,
    });
    if (res.status !== "complete") return `incomplete: ${res.status}`;
    await window.Clerk.setActive({ session: res.createdSessionId });
    return "complete";
  } catch (e) {
    return "failed: " + (e?.errors?.[0]?.message ?? e?.message ?? String(e));
  }
}, token);
console.log("Clerk sign-in:", signIn);
if (signIn !== "complete") {
  await browser.close();
  process.exit(1);
}

// Full reload so the React tree re-evaluates auth from scratch — the same
// path a real user's refresh takes (RequireAuth → InstantAuthSync → gates).
await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);

const body = (await page.locator("body").innerText()).trim();
console.log("URL:", page.url());
console.log("--- rendered screen (first 400 chars) ---");
console.log(body.slice(0, 400));
console.log("--- console/page errors ---");
console.log(errors.join("\n") || "(none)");

mkdirSync("/tmp/pw-test/screenshots", { recursive: true });
await page.screenshot({
  path: "/tmp/pw-test/screenshots/agent-login.png",
  fullPage: true,
});
await context.storageState({ path: STATE_FILE });
console.log(`Storage state saved to ${STATE_FILE} — reuse with`);
console.log(`  browser.newContext({ storageState: "${STATE_FILE}" })`);
await browser.close();
