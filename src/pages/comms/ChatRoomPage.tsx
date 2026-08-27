import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { isParticipant } from "../../lib/comms";
import {
  postChatAttachment,
  postChatMessage,
  setChatRoomInvite,
  useChatAttachments,
  useChatMessages,
  useChatRoom,
  useChatRoomRoles,
  useChatRoomUsers,
} from "../../data/comms";
import { useRoleIdsFor, useRoles, useUsers } from "../../data/users";
import { attachmentUrl, captureAttachment } from "../../data/files";

// Comms — Chat Room (see docs/pages/chat-room.html).
// Internal messaging, entirely separate from calls and SMS with no database
// relationship between them. It is ours end to end, so unlike SMS it works
// fully offline — a message typed in a dead zone is a real message that
// arrives when the phone does.
export function ChatRoomPage() {
  const { id: roomId } = useParams();
  const current = useCurrent();
  const [body, setBody] = useState("");
  const [managing, setManaging] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const room = useChatRoom(roomId);
  const { data: messages } = useChatMessages(roomId);
  const { data: attachments } = useChatAttachments(roomId);
  const { data: invitedUsers } = useChatRoomUsers(roomId);
  const { data: invitedRoles } = useChatRoomRoles(roomId);
  const { data: users } = useUsers();
  const { roles } = useRoles();
  const roleIds = useRoleIdsFor(current.user?.id);

  const attachmentsByMessage = useMemo(() => {
    const m = new Map<string, typeof attachments>();
    for (const a of attachments) {
      const list = m.get(a.message_id) ?? [];
      list.push(a);
      m.set(a.message_id, list);
    }
    return m;
  }, [attachments]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  if (!room) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const participant = isParticipant(
    {
      id: room.id,
      created_by_id: room.created_by_id,
      invitedUserIds: invitedUsers.map((u) => u.user_id),
      invitedRoleIds: invitedRoles.map((r) => r.role_id),
    },
    current.user?.id,
    roleIds,
  );
  const canReadAnyway = current.can("view_all_chats");
  const canManageChats = current.can("manage_chats");
  const isCreator = room.created_by_id === current.user?.id;

  // Not a participant and no view_all_chats: the room isn't reachable at all.
  if (!participant && !canReadAnyway) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
        <Link to="/comms">← Back to Comms</Link>
      </div>
    );
  }

  const send = async () => {
    if (!body.trim() || !current.user) return;
    await postChatMessage(room.id, body.trim(), current.user.id);
    setBody("");
  };

  // The Join action behind the composer overlay — adds the current user as a
  // real participant from this point forward.
  const join = async () => {
    if (!current.user) return;
    await setChatRoomInvite("user", room.id, current.user.id, true);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{room.title ?? "Chat"}</h1>
          <div className="page-sub">
            {room.topic ? `${room.topic} · ` : ""}
            <Link to="/comms">← Comms</Link>
          </div>
        </div>
        {(isCreator || canManageChats) && (
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => setManaging(!managing)}
          >
            {managing ? "Done" : "People"}
          </button>
        )}
      </div>

      {managing && (
        <InviteManager
          roomId={room.id}
          invitedUserIds={invitedUsers.map((u) => u.user_id)}
          invitedRoleIds={invitedRoles.map((r) => r.role_id)}
          users={users}
          roles={roles}
        />
      )}

      <div className="chat-scroll">
        {messages.map((m) => {
          const mine = m.author_id === current.user?.id;
          return (
            <div key={m.id} className={"chat-msg" + (mine ? " chat-mine" : "")}>
              <div className="chat-meta">
                {m.author_name ?? "Unknown"} ·{" "}
                {new Date(m.timestamp).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
              <div className="chat-body">{m.body}</div>
              <EntityPreviews body={m.body} />
              {(attachmentsByMessage.get(m.id) ?? []).map((f) => {
                const url = attachmentUrl(f.storage_path);
                const name = f.storage_path?.split("/").pop() ?? "attachment";
                // A pending attachment is one whose bytes have not had a
                // connection yet. It renders as pending rather than as a
                // broken link, because the row arriving without the file is
                // the normal offline case, not a failure.
                return url && f.upload_state === "uploaded" ? (
                  <a key={f.id} href={url} target="_blank" rel="noreferrer" className="small">
                    📎 {name}
                  </a>
                ) : (
                  <span key={f.id} className="small muted">
                    📎 {name} — uploading
                  </span>
                );
              })}
            </div>
          );
        })}
        {messages.length === 0 && (
          <span className="muted small">No messages yet.</span>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        {participant ? (
          <div className="row">
            <textarea
              className="textarea"
              rows={2}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <AttachButton roomId={room.id} />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!body.trim()}
              onClick={() => void send()}
            >
              Send
            </button>
          </div>
        ) : (
          // Read access without participation: composer disabled. With
          // manage_chats, an overlay offers to join; without it, no overlay.
          <div className="composer-locked">
            <textarea
              className="textarea"
              rows={2}
              disabled
              placeholder="You're reading this room, not participating in it."
            />
            {canManageChats && (
              <button type="button" className="btn btn-primary" onClick={() => void join()}>
                Join the conversation
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Pasted entity URLs render as preview cards for display only — link
// parsing, never a stored relationship.
function EntityPreviews({ body }: { body: string }) {
  const paths = useMemo(() => {
    const matches = body.match(/\/(locations|boats|vehicles|assets|contacts|tickets|incidents|reservations)\/[\w-]+/g);
    return [...new Set(matches ?? [])];
  }, [body]);

  if (paths.length === 0) return null;
  return (
    <div className="row" style={{ flexWrap: "wrap", marginTop: 4 }}>
      {paths.map((p) => (
        <Link key={p} to={p} className="badge badge-accent">
          {p.split("/")[1].replace(/s$/, "")} link
        </Link>
      ))}
    </div>
  );
}

function AttachButton({ roomId }: { roomId: string }) {
  const current = useCurrent();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    if (!current.user) return;
    setBusy(true);
    setError(null);
    try {
      const attachmentId = await captureAttachment(file, current.user.id);
      await postChatAttachment(roomId, attachmentId, file.name, current.user.id);
    } catch (err) {
      // Bytes need a connection; the row does not. Saying so beats a paperclip
      // that silently does nothing.
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="btn btn-sm" style={{ cursor: "pointer" }} title={error ?? undefined}>
      {busy ? "…" : error ? "⚠" : "📎"}
      <input
        type="file"
        style={{ display: "none" }}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
    </label>
  );
}

function InviteManager({
  roomId,
  invitedUserIds,
  invitedRoleIds,
  users,
  roles,
}: {
  roomId: string;
  invitedUserIds: string[];
  invitedRoleIds: string[];
  users: { id: string; name: string }[];
  roles: { id: string; name: string }[];
}) {
  const invitedUsers = new Set(invitedUserIds);
  const invitedRoles = new Set(invitedRoleIds);

  const toggle = (kind: "user" | "role", targetId: string, on: boolean) =>
    void setChatRoomInvite(kind, roomId, targetId, on);

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="field">
        <span className="field-label">Invited users</span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {users.map((u) => (
            <label key={u.id} className="row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={invitedUsers.has(u.id)}
                onChange={(e) => toggle("user", u.id, e.target.checked)}
              />
              <span className="small">{u.name}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <span className="field-label">Invited roles</span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {roles.map((r) => (
            <label key={r.id} className="row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={invitedRoles.has(r.id)}
                onChange={(e) => toggle("role", r.id, e.target.checked)}
              />
              <span className="small">{r.name}</span>
            </label>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>
          A role invite is live — anyone granted that role later gains access
          without being re-invited.
        </p>
      </div>
    </div>
  );
}
