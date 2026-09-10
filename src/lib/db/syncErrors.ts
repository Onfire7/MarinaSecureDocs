/**
 * Telling a misconfigured backend apart from a dead zone.
 *
 * PowerSync reports both the same way — a download error on its status — and
 * the app's two screens for them are opposites. "Move somewhere with signal"
 * is right for a guard on a dock and actively harmful for a broken instance,
 * because it sends someone walking around a marina to fix a dashboard field.
 * Guessing wrong in the other direction is worse still: a configuration
 * screen shown to every guard who steps behind a boathouse.
 *
 * The distinction is NOT auth-versus-other, which is what an earlier version
 * of this predicate tested. It is:
 *
 *   the server answered and told us something is wrong   → configuration
 *   we never reached the server                          → connectivity
 *
 * A reply carrying an HTTP status or a PSYNC error code is the first kind, no
 * matter which class the code falls in. That version matched PSYNC_S21xx and
 * S22xx only, so PSYNC_S2302 — "No sync config available", an instance with no
 * sync rules deployed, HTTP 500 — fell through to the offline screen and told
 * someone with a perfectly good connection to go find signal.
 */

/**
 * A PowerSync error code (`PSYNC_S1234`), or an HTTP status the service
 * returned. Both mean the request arrived somewhere that could answer it.
 */
const SERVER_ANSWERED = /PSYNC_[SE]\d{4}|\bHTTP\b|\b[45]\d\d\b|Unauthorized|Forbidden/i;

/**
 * True when the reason is something no amount of signal will fix, and the user
 * should be shown it verbatim.
 *
 * Anything unrecognised is treated as connectivity, not configuration. That
 * bias is deliberate and it is not symmetric: a misconfigured instance is a
 * one-off that someone is already investigating, while a device losing signal
 * is the normal condition of a guard walking a dock at 2am. Showing that guard
 * a wall of JSON every time they pass a boathouse would train everyone to
 * ignore the screen that matters. The console keeps the full message either
 * way.
 */
export function isConfigurationError(message: string): boolean {
  return SERVER_ANSWERED.test(message);
}

/**
 * The message out of whatever PowerSync hands us.
 *
 * NOT `err instanceof Error`. Sync errors are raised inside a Web Worker and
 * reach this thread by structured clone, which copies `name`, `message` and
 * `stack` and drops the prototype — so the check is false for every one of
 * them, and `String(err)` is the string "[object Object]".
 *
 * This was not theoretical. The first version of this code used `instanceof`,
 * and the result was that a PSYNC_S2105 rejection — a token the service will
 * never accept — was recorded as "[object Object]", failed the refusal test,
 * and left the app showing "find some signal" while the console said exactly
 * what was wrong.
 */
export function errorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
