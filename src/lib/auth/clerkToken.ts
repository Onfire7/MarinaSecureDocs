// The Clerk session token, reachable from outside React.
//
// PowerSync's connector is not a component: it asks for credentials whenever
// it reconnects, which can be minutes after any render and is triggered by the
// network, not by the tree. Clerk's own `getToken` is only available through
// `useAuth()`, so a component has to hand it over — that is all this file is.
//
// It is a mutable module-level value on purpose. On a shared device, User
// Switch changes the active Clerk session without unmounting anything, and the
// connector must start returning the *new* user's token from that moment. A
// value captured once at startup would keep syncing the previous guard's data
// under the next guard's session.

type TokenSource = () => Promise<string | null>;

let source: TokenSource | null = null;

/** Called by PowerSyncProvider whenever the active Clerk session changes. */
export function setClerkTokenSource(fn: TokenSource | null) {
  source = fn;
}

/**
 * The active session's JWT, or null when signed out.
 *
 * Both Supabase and PowerSync verify this same token — Supabase as a
 * third-party auth provider, PowerSync against Clerk's JWKS — so there is one
 * token and one source of it.
 */
export async function getClerkToken(): Promise<string | null> {
  if (!source) return null;
  return source();
}
