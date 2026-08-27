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

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!CLERK_PUBLISHABLE_KEY) missing.push("VITE_CLERK_PUBLISHABLE_KEY");
  if (!SUPABASE_URL) missing.push("VITE_SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("VITE_SUPABASE_ANON_KEY");
  if (!POWERSYNC_URL) missing.push("VITE_POWERSYNC_URL");
  return missing;
}
