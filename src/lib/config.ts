// Per-marina build/environment configuration (see .env.example).
//
// Every marina is a separate deployment with its own Supabase project, its own
// PowerSync instance and its own Clerk application. Nothing here is shared, and
// nothing here is secret: all three values ship in the browser bundle. The anon
// key grants nothing on its own — RLS evaluates against the Clerk JWT, and a
// request without one is an unauthenticated request that every policy denies.

export const CLERK_PUBLISHABLE_KEY = import.meta.env
  .VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

/** The marina's Supabase project URL — PostgREST, Storage, and Realtime. */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as
  | string
  | undefined;

export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

/** The marina's PowerSync service — where the device's SQLite syncs from. */
export const POWERSYNC_URL = import.meta.env.VITE_POWERSYNC_URL as
  | string
  | undefined;

/**
 * The origin to put in a link somebody else will open - a share link, an
 * NFC tag's check-in URL.
 *
 * NOT `window.location.origin`. A link built from wherever the app happened
 * to be open carries that address to its recipient: a link made from
 * `marinasecure2.netlify.app`, or from a branch preview, or from a PWA
 * installed at an old address, goes out with that domain on it. The marina
 * has one public address and a link should always carry it.
 *
 * Netlify sets `URL` to the site's primary domain at build time, and
 * netlify.toml passes it in - deliberately, so this is a line in the repo
 * rather than another dashboard field nobody remembers (CLAUDE.md:
 * "anything that is a file locally and a dashboard field remotely will be
 * forgotten"). Unset - `pnpm dev`, a bare `vite build` - it falls back to
 * the current origin, which is right for localhost.
 */
export const PUBLIC_URL = import.meta.env.VITE_PUBLIC_URL as string | undefined;

export function publicOrigin(configured: string | undefined = PUBLIC_URL, here?: string): string {
  const fallback = here ?? (typeof window === "undefined" ? "" : window.location.origin);
  const trimmed = (configured ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//.test(trimmed) ? trimmed : fallback;
}

/**
 * Where a page open on the wrong host should send itself, or null to stay.
 *
 * A share link is pasted, forwarded and typed by hand, and it only takes
 * one of those for it to arrive on an address that is not the marina's.
 * Some of those addresses serve this same build and work; the one a
 * character away - `beta.marinasecure.com` - is a different build with no
 * `/r/` route, which asks the recipient to sign in. This only moves the
 * public report: the app itself stays reachable on a branch deploy or the
 * netlify.app name, which is what makes a wrong-origin bug testable.
 *
 * Returns null when there is nothing to do, so the caller renders. The
 * comparison is exact and the destination is the configured origin, so the
 * redirected page cannot match again.
 */
export function canonicalTarget(
  here: string,
  pathAndQuery: string,
  configured: string | undefined = PUBLIC_URL,
): string | null {
  // Both sides normalised, or a trailing slash on one of them is an
  // infinite redirect: the destination would never equal the origin it
  // just arrived from.
  const trim = (s: string) => s.trim().replace(/\/+$/, "");
  const want = trim(configured ?? "");
  if (!/^https?:\/\//.test(want)) return null;
  if (trim(here) === want) return null;
  if (!pathAndQuery.startsWith("/r/")) return null;
  return want + pathAndQuery;
}

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!CLERK_PUBLISHABLE_KEY) missing.push("VITE_CLERK_PUBLISHABLE_KEY");
  if (!SUPABASE_URL) missing.push("VITE_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("VITE_SUPABASE_ANON_KEY");
  if (!POWERSYNC_URL) missing.push("VITE_POWERSYNC_URL");
  return missing;
}
