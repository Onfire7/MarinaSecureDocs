// What the save indicator says, decided in one pure place.
//
// See src/layout/SaveIndicator.spec.md for the states and, more to the point,
// for why "saved here" and "reached the office" must never again look
// the same. The words come from layout:save, through the caller's `t`.

import type { TFunction } from "i18next";

export interface SaveInputs {
  /** Writes in the device's upload queue. */
  queued: number;
  connected: boolean;
  uploading: boolean;
  /** The last upload error's message, if there is one. */
  uploadError: string | null;
  /** How long the queue has been non-empty without getting any shorter. */
  unchangedForMs: number;
  /** Writes the office refused for good, not yet dismissed. */
  rejected: number;
}

export interface SaveState {
  kind: "sent" | "waiting" | "sending" | "stuck" | "rejected";
  tone: "quiet" | "amber" | "danger";
  label: string;
  /** The real reason, verbatim, when there is one worth showing. */
  detail?: string;
}

const STUCK_AFTER_MS = 60_000;
// An expired token is routine after a phone wakes and heals by itself, so it
// gets far longer before it counts as a fault rather than a slow reconnect.
const STUCK_AFTER_MS_IF_TOKEN_EXPIRED = 5 * 60_000;
const TOKEN_EXPIRED = /PSYNC_S2103|PGRST303|JWT (has )?expired/i;

export function saveState(i: SaveInputs, t: TFunction<"layout">): SaveState {
  // First, because a clean queue proves nothing here: the queue is clean
  // BECAUSE the write was thrown away.
  if (i.rejected > 0) {
    return {
      kind: "rejected",
      tone: "danger",
      label: t("save.rejected", { count: i.rejected }),
    };
  }
  if (i.queued === 0) {
    return { kind: "sent", tone: "quiet", label: t("save.sent") };
  }
  if (!i.connected) {
    // Not an error however long it lasts. The work is saved, and says so.
    return {
      kind: "waiting",
      tone: "amber",
      label: t("save.waiting", { count: i.queued }),
      detail: t("save.waitingDetail"),
    };
  }
  const limit =
    i.uploadError && TOKEN_EXPIRED.test(i.uploadError)
      ? STUCK_AFTER_MS_IF_TOKEN_EXPIRED
      : STUCK_AFTER_MS;
  if (i.unchangedForMs > limit) {
    return {
      kind: "stuck",
      tone: "danger",
      label: t("save.stuck", { count: i.queued }),
      detail: i.uploadError ?? t("save.stuckDetail"),
    };
  }
  return { kind: "sending", tone: "quiet", label: t("save.sending", { count: i.queued }) };
}
