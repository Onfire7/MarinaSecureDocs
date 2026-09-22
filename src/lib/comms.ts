// Comms — shared helpers (see docs: pages/comms-home.html, chat-room.html).
//
// Telephony is the one online-only surface in the app: calls and SMS are
// placed by Twilio Functions, which are also the only writers of
// Twilio-sourced data (see docs/architecture.md). Chat, by contrast, is ours
// end to end and works fully offline.

export interface ChatRoomLike {
  id: string;
  created_by_id?: string | null;
  invitedUserIds?: string[];
  invitedRoleIds?: string[];
}

/**
 * Participant status isn't stored — it's computed from creator, direct
 * invites, and role invites. The role invite is a live reference, so someone
 * granted that role later gains access without being re-invited.
 *
 * view_all_chats deliberately does NOT satisfy this: it grants reading a
 * room, never posting in it.
 */
export function isParticipant(
  room: ChatRoomLike,
  userId: string | undefined,
  userRoleIds: string[],
): boolean {
  if (!userId) return false;
  if (room.created_by_id === userId) return true;
  if ((room.invitedUserIds ?? []).includes(userId)) return true;
  return (room.invitedRoleIds ?? []).some((r) => userRoleIds.includes(r));
}

export interface PhoneLine {
  number: string;
  label: string;
  routing?: Record<string, unknown>;
}

export function formatCallDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "Unknown number";
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

/**
 * Calls the Twilio Functions bridge. Every telephony action routes through
 * it — the frontend never talks to Twilio directly, and never writes
 * Twilio-sourced data itself. Until that layer is deployed these fail, which
 * callers surface rather than swallow.
 */
export async function twilioRequest(
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`/api/twilio${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `${path} failed (${res.status}) — the Twilio Functions bridge isn't deployed yet.`,
    );
  }
}
