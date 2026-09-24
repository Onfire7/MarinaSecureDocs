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

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!CLERK_PUBLISHABLE_KEY) missing.push("VITE_CLERK_PUBLISHABLE_KEY");
  if (!SUPABASE_URL) missing.push("VITE_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("VITE_SUPABASE_ANON_KEY");
  if (!POWERSYNC_URL) missing.push("VITE_POWERSYNC_URL");
  return missing;
}
