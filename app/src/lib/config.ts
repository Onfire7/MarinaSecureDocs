// Per-marina build/environment configuration (see .env.example).

export const CLERK_PUBLISHABLE_KEY = import.meta.env
  .VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

// Name of the Clerk client registered on the InstantDB app
// (InstantDB dashboard → Auth → Clerk).
export const INSTANT_CLERK_CLIENT_NAME =
  (import.meta.env.VITE_INSTANT_CLERK_CLIENT_NAME as string | undefined) ??
  "clerk";

import { INSTANT_APP_ID } from "./db";

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!INSTANT_APP_ID) missing.push("VITE_INSTANT_APP_ID");
  if (!CLERK_PUBLISHABLE_KEY) missing.push("VITE_CLERK_PUBLISHABLE_KEY");
  return missing;
}
