#!/usr/bin/env node
// What is actually in this marina's Clerk session token?
//
// Three separate systems read that token and each wants something different
// from it, so "the login works" is not the same as "the token is right":
//
//   sub              every RLS policy joins users.clerk_user_id to it
//   email + email_verified   claim_marina_user() binds a provisioned row on it
//   role             Supabase's third-party auth expects "authenticated"
//   aud              PowerSync REQUIRES it and rejects the token without one
//
// Clerk's session token carries none of `aud` by default, which is why the app
// can sign in perfectly and then sync nothing at all. This prints the real
// claims off a real minted token so that question is answered by looking
// rather than by assuming.
//
//   node scripts/check-clerk-claims.mjs
//   APP_URL=http://localhost:5173 node scripts/check-clerk-claims.mjs
//
// It signs in headlessly the same way scripts/agent-login.mjs does: a
// single-use Clerk sign-in token, spent immediately, no passwords involved.
import { chromium } from "playwright";
import { loadEnv } from "./env.mjs";

const env = loadEnv();
const APP_URL = env.APP_URL ?? "https://beta.marinasecure.com";
const EMAIL = env.LOGIN_EMAIL ?? "gpp@onfire.us";

if (!env.CLERK_SECRET_KEY) {
  console.error("CLERK_SECRET_KEY not found in .env.local or environment");
  process.exit(1);
}

async function clerkApi(path, opts = {}) {
  const res = await fetch(`https://api.clerk.com/v1${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${env.CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Clerk ${path}: ${JSON.stringify(body.errors ?? body)}`);
  return body;
}

const users = await clerkApi(`/users?email_address=${encodeURIComponent(EMAIL)}`);
if (!users.length) {
  console.error(`No Clerk user exists for ${EMAIL}`);
  process.exit(1);
}
const { token } = await clerkApi("/sign_in_tokens", {
  method: "POST",
  body: JSON.stringify({ user_id: users[0].id, expires_in_seconds: 600 }),
});

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${APP_URL}/sign-in?__clerk_ticket=${token}`, {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => window.Clerk?.session, null, { timeout: 30_000 });
  const jwt = await page.evaluate(() => window.Clerk.session.getToken());
  const claims = JSON.parse(
    Buffer.from(jwt.split(".")[1], "base64").toString("utf8"),
  );

  console.log(`\nSession token for ${EMAIL} (via ${APP_URL}):\n`);
  console.log(JSON.stringify(claims, null, 2));

  const checks = [
    ["sub", Boolean(claims.sub), "identity — every RLS policy joins on it"],
    ["email", Boolean(claims.email), "first sign-in binds the marina user on it"],
    [
      "email_verified",
      claims.email_verified === true,
      "an unverified address must not claim an account",
    ],
    [
      "role",
      claims.role === "authenticated",
      'Supabase third-party auth expects "authenticated"',
    ],
    ["aud", Boolean(claims.aud), "PowerSync REJECTS a token without it (PSYNC_S2105)"],
  ];

  console.log("");
  let failed = 0;
  for (const [name, ok, why] of checks) {
    if (!ok) failed++;
    console.log(`  ${ok ? "✓" : "✗"} ${name.padEnd(15)} ${why}`);
  }

  if (failed > 0) {
    console.log(
      "\nFix in the Clerk dashboard → Configure → Sessions → Customize session token.",
    );
    process.exit(1);
  }
  console.log("\nEvery claim the stack needs is present.\n");
} finally {
  await browser.close();
}
