import { useQuery } from "@powersync/react";
import { db, stamp } from "../lib/db";
import { insert, remove, transact, update } from "./sql";

// Calls, SMS and chat.
//
// Telephony is the one online-only surface in the app: calls and texts are
// placed by Twilio Functions, which are also the only writers of Twilio-sourced
// data. But the RECORD of a call is ordinary data and reads offline like
// anything else — which is why every query here runs against the device's own
// database even though nothing here can dial.
//
// Chat is different again: it is ours end to end, so it is written locally and
// syncs like any other table. A message typed in a dead zone is a real message
// that arrives when the phone does.

export interface CallRow {
  id: string;
  direction: string;
  line: string | null;
  from_number: string | null;
  to_number: string | null;
  started_at: string | null;
  duration: number | null;
  recording_url: string | null;
  transcript: string | null;
  missed: number;
  voicemail_url: string | null;
  contact_id: string | null;
  contact_name: string | null;
}

const CALL_SELECT = `
  SELECT c.*, ct.name AS contact_name
    FROM calls c
    LEFT JOIN contacts ct ON ct.id = c.contact_id`;

export function useCalls(limit = 100) {
  return useQuery<CallRow>(
    `${CALL_SELECT} ORDER BY c.started_at DESC LIMIT ?`,
    [limit],
  );
}

export function useCall(callId: string | undefined) {
  const { data } = useQuery<CallRow>(`${CALL_SELECT} WHERE c.id = ?`, [callId ?? ""]);
  return data[0] ?? null;
}

/** Calls still ringing or connected — what drives the active-call panel. */
export function useActiveCalls() {
  return useQuery<CallRow>(
    `${CALL_SELECT} WHERE c.duration IS NULL AND c.missed = 0
      ORDER BY c.started_at DESC`,
  );
}

export function useMissedCalls() {
  return useQuery<CallRow>(
    `${CALL_SELECT} WHERE c.missed = 1 ORDER BY c.started_at DESC`,
  );
}

export interface CallNoteRow {
  id: string;
  call_id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  author_name: string | null;
}

export function useCallNotes(callId: string | undefined) {
  return useQuery<CallNoteRow>(
    `SELECT n.*, u.name AS author_name FROM call_notes n
       LEFT JOIN users u ON u.id = n.author_id
      WHERE n.call_id = ? ORDER BY n.created_at`,
    [callId ?? ""],
  );
}

export function addCallNote(
  callId: string,
  body: string,
  actorId: string | null,
): Promise<string> {
  return insert(db, "call_notes", {
    call_id: callId,
    body,
    created_at: stamp(),
    author_id: actorId,
  });
}

export interface SmsThreadRow {
  id: string;
  line: string | null;
  contact_id: string | null;
  last_message_at: string | null;
  unread: number;
  contact_name: string | null;
  contact_phone: string | null;
  message_count: number;
}

const THREAD_SELECT = `
  SELECT t.*, c.name AS contact_name,
         (SELECT d.phone FROM contact_details d WHERE d.contact_id = t.contact_id)
           AS contact_phone,
         (SELECT COUNT(*) FROM sms_messages m WHERE m.thread_id = t.id)
           AS message_count
    FROM sms_threads t
    LEFT JOIN contacts c ON c.id = t.contact_id`;

export function useSmsThreads() {
  return useQuery<SmsThreadRow>(
    `${THREAD_SELECT} ORDER BY t.last_message_at DESC`,
  );
}

export function useSmsThread(threadId: string | undefined) {
  const { data } = useQuery<SmsThreadRow>(`${THREAD_SELECT} WHERE t.id = ?`, [
    threadId ?? "",
  ]);
  return data[0] ?? null;
}

export interface SmsMessageRow {
  id: string;
  thread_id: string;
  direction: string;
  body: string;
  timestamp: string;
  sent_by_id: string | null;
  sent_by_name: string | null;
}

export function useSmsMessages(threadId: string | undefined) {
  return useQuery<SmsMessageRow>(
    `SELECT m.*, u.name AS sent_by_name FROM sms_messages m
       LEFT JOIN users u ON u.id = m.sent_by_id
      WHERE m.thread_id = ? ORDER BY m.timestamp`,
    [threadId ?? ""],
  );
}

/**
 * Mark a thread read.
 *
 * The only write the client makes to an SMS thread. Everything else about one —
 * the messages, the contact match, last_message_at — is written by the Twilio
 * Function that handled the text, because the value that lands should be
 * Twilio's version rather than what the client guessed.
 */
export function markThreadRead(threadId: string): Promise<void> {
  return update(db, "sms_threads", threadId, { unread: 0 });
}

// ---------------------------------------------------------------- chat

export interface ChatRoomRow {
  id: string;
  title: string | null;
  topic: string | null;
  created_at: string;
  created_by_id: string | null;
  creator_name: string | null;
  last_message_at: string | null;
  message_count: number;
}

const ROOM_SELECT = `
  SELECT r.*, u.name AS creator_name,
         (SELECT MAX(m.timestamp) FROM chat_messages m WHERE m.room_id = r.id)
           AS last_message_at,
         (SELECT COUNT(*) FROM chat_messages m WHERE m.room_id = r.id)
           AS message_count
    FROM chat_rooms r
    LEFT JOIN users u ON u.id = r.created_by_id`;

export function useChatRooms() {
  return useQuery<ChatRoomRow>(
    `${ROOM_SELECT} ORDER BY COALESCE(last_message_at, r.created_at) DESC`,
  );
}

export function useChatRoom(roomId: string | undefined) {
  const { data } = useQuery<ChatRoomRow>(`${ROOM_SELECT} WHERE r.id = ?`, [
    roomId ?? "",
  ]);
  return data[0] ?? null;
}

export function useChatRoomUsers(roomId?: string) {
  return useQuery<{ id: string; room_id: string; user_id: string; name: string }>(
    roomId
      ? `SELECT ru.*, u.name FROM chat_room_users ru
           JOIN users u ON u.id = ru.user_id WHERE ru.room_id = ?`
      : `SELECT ru.*, u.name FROM chat_room_users ru JOIN users u ON u.id = ru.user_id`,
    roomId ? [roomId] : [],
  );
}

export function useChatRoomRoles(roomId?: string) {
  return useQuery<{ id: string; room_id: string; role_id: string; name: string }>(
    roomId
      ? `SELECT rr.*, r.name FROM chat_room_roles rr
           JOIN roles r ON r.id = rr.role_id WHERE rr.room_id = ?`
      : `SELECT rr.*, r.name FROM chat_room_roles rr JOIN roles r ON r.id = rr.role_id`,
    roomId ? [roomId] : [],
  );
}

export interface ChatMessageRow {
  id: string;
  room_id: string;
  author_id: string | null;
  body: string;
  timestamp: string;
  author_name: string | null;
}

export function useChatMessages(roomId: string | undefined) {
  return useQuery<ChatMessageRow>(
    `SELECT m.*, u.name AS author_name FROM chat_messages m
       LEFT JOIN users u ON u.id = m.author_id
      WHERE m.room_id = ? ORDER BY m.timestamp`,
    [roomId ?? ""],
  );
}

export function postChatMessage(
  roomId: string,
  body: string,
  actorId: string | null,
): Promise<string> {
  return insert(db, "chat_messages", {
    room_id: roomId,
    author_id: actorId,
    body,
    timestamp: stamp(),
  });
}

export async function createChatRoom(input: {
  title: string;
  topic?: string | null;
  userIds: string[];
  roleIds: string[];
  createdById: string | null;
}): Promise<string> {
  return transact(async (tx) => {
    const roomId = await insert(tx, "chat_rooms", {
      title: input.title,
      topic: input.topic ?? null,
      created_at: stamp(),
      created_by_id: input.createdById,
    });
    for (const userId of input.userIds) {
      await insert(tx, "chat_room_users", { room_id: roomId, user_id: userId });
    }
    for (const roleId of input.roleIds) {
      await insert(tx, "chat_room_roles", { room_id: roomId, role_id: roleId });
    }
    return roomId;
  });
}

export function leaveChatRoom(linkId: string): Promise<void> {
  return remove(db, "chat_room_users", linkId);
}

/** Invite or uninvite one user or role. */
export async function setChatRoomInvite(
  kind: "user" | "role",
  roomId: string,
  targetId: string,
  invited: boolean,
): Promise<void> {
  const table = kind === "user" ? "chat_room_users" : "chat_room_roles";
  const column = kind === "user" ? "user_id" : "role_id";
  const existing = await db.getOptional<{ id: string }>(
    `SELECT id FROM ${table} WHERE room_id = ? AND ${column} = ?`,
    [roomId, targetId],
  );
  if (invited && !existing) {
    await insert(db, table, { room_id: roomId, [column]: targetId });
  } else if (!invited && existing) {
    await remove(db, table, existing.id);
  }
}

export interface ChatAttachmentRow {
  id: string;
  message_id: string;
  attachment_id: string;
  storage_path: string | null;
  upload_state: string | null;
}

export function useChatAttachments(roomId: string | undefined) {
  return useQuery<ChatAttachmentRow>(
    `SELECT ma.*, a.storage_path, a.upload_state
       FROM chat_message_attachments ma
       JOIN chat_messages m ON m.id = ma.message_id
       LEFT JOIN attachments a ON a.id = ma.attachment_id
      WHERE m.room_id = ?`,
    [roomId ?? ""],
  );
}

/** Post a message carrying an already-captured attachment. */
export async function postChatAttachment(
  roomId: string,
  attachmentId: string,
  fileName: string,
  actorId: string | null,
): Promise<string> {
  return transact(async (tx) => {
    const messageId = await insert(tx, "chat_messages", {
      room_id: roomId,
      author_id: actorId,
      body: `📎 ${fileName}`,
      timestamp: stamp(),
    });
    await insert(tx, "chat_message_attachments", {
      message_id: messageId,
      attachment_id: attachmentId,
    });
    return messageId;
  });
}


// ---------------------------------------------------------------- templates

export interface SmsTemplateRow {
  id: string;
  label: string;
  body: string;
  scope: string;
  owner_id: string | null;
}

/**
 * The templates one user may send with: every global one, plus their own.
 *
 * Everyone's personal templates sync to every device — sms_templates is in the
 * always-resident tier and has no per-owner gate — so the filter here is about
 * not offering someone else's shorthand, not about withholding it.
 */
export function useSmsTemplates(ownerId: string | undefined) {
  return useQuery<SmsTemplateRow>(
    `SELECT * FROM sms_templates
      WHERE scope = 'global' OR owner_id = ?
      ORDER BY scope, label`,
    [ownerId ?? ""],
  );
}

export function createSmsTemplate(input: {
  label: string;
  body: string;
  scope: "global" | "personal";
  ownerId: string | null;
}): Promise<string> {
  return insert(db, "sms_templates", {
    label: input.label,
    body: input.body,
    scope: input.scope,
    owner_id: input.ownerId,
  });
}

export function saveSmsTemplate(
  templateId: string,
  input: { label?: string; body?: string },
): Promise<void> {
  return update(db, "sms_templates", templateId, input);
}

export function deleteSmsTemplate(templateId: string): Promise<void> {
  return remove(db, "sms_templates", templateId);
}
