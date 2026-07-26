import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { isParticipant } from "../../lib/comms";

// Comms — Chat Room (see docs/pages/chat-room.html).
// Internal messaging, entirely separate from calls/SMS with no database
// relationship between them. Ordinary InstantDB data, so it works fully
// offline unlike SMS.
export function ChatRoomPage() {
  const { id: roomId } = useParams();
  const current = useCurrent();
  const [body, setBody] = useState("");
  const [managing, setManaging] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data } = db.useQuery(
    roomId
      ? {
          chatRooms: {
            $: { where: { id: roomId } },
            createdBy: {},
            invitedUsers: {},
            invitedRoles: {},
            messages: { author: {}, attachments: {} },
          },
          users: { $: { where: { active: true } } },
          roles: {},
        }
      : null,
  );
  const room = data?.chatRooms?.[0];

  const messages = useMemo(
    () =>
      [...(room?.messages ?? [])].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      ),
    [room],
  );

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

  const roleIds = (current.user?.roles ?? []).map((r) => r.id);
  const participant = isParticipant(room, current.user?.id, roleIds);
  const canReadAnyway = current.can("view_all_chats");
  const canManageChats = current.can("manage_chats");
  const isCreator = room.createdBy?.id === current.user?.id;

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
    await db.transact(
      db.tx.chatMessages[id()]
        .update({ body: body.trim(), timestamp: Date.now() })
        .link({ room: room.id, author: current.user.id }),
    );
    setBody("");
  };

  // The Join action behind the composer overlay — adds the current user as a
  // real participant from this point forward.
  const join = async () => {
    if (!current.user) return;
    await db.transact(
      db.tx.chatRooms[room.id].link({ invitedUsers: current.user.id }),
    );
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{room.title}</h1>
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
          room={room}
          users={data?.users ?? []}
          roles={data?.roles ?? []}
        />
      )}

      <div className="chat-scroll">
        {messages.map((m) => {
          const mine = m.author?.id === current.user?.id;
          return (
            <div key={m.id} className={"chat-msg" + (mine ? " chat-mine" : "")}>
              <div className="chat-meta">
                {m.author?.name ?? "Unknown"} ·{" "}
                {new Date(m.timestamp).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </div>
              <div className="chat-body">{m.body}</div>
              <EntityPreviews body={m.body} />
              {(m.attachments ?? []).map((f) => (
                <a
                  key={f.id}
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="small"
                >
                  📎 {f.path.split("/").pop()}
                </a>
              ))}
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

  const upload = async (file: File) => {
    if (!current.user) return;
    setBusy(true);
    try {
      const path = `chat/${roomId}/${Date.now()}-${file.name}`;
      const { data } = await db.storage.uploadFile(path, file);
      await db.transact(
        db.tx.chatMessages[id()]
          .update({ body: `📎 ${file.name}`, timestamp: Date.now() })
          .link({ room: roomId, author: current.user.id, attachments: data.id }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="btn btn-sm" style={{ cursor: "pointer" }}>
      {busy ? "…" : "📎"}
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
  room,
  users,
  roles,
}: {
  room: {
    id: string;
    invitedUsers?: { id: string; name: string }[];
    invitedRoles?: { id: string; name: string }[];
  };
  users: { id: string; name: string }[];
  roles: { id: string; name: string }[];
}) {
  const invitedUserIds = new Set((room.invitedUsers ?? []).map((u) => u.id));
  const invitedRoleIds = new Set((room.invitedRoles ?? []).map((r) => r.id));

  const toggle = (kind: "invitedUsers" | "invitedRoles", targetId: string, on: boolean) =>
    void db.transact(
      on
        ? db.tx.chatRooms[room.id].link({ [kind]: targetId })
        : db.tx.chatRooms[room.id].unlink({ [kind]: targetId }),
    );

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="field">
        <span className="field-label">Invited users</span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {users.map((u) => (
            <label key={u.id} className="row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={invitedUserIds.has(u.id)}
                onChange={(e) => toggle("invitedUsers", u.id, e.target.checked)}
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
                checked={invitedRoleIds.has(r.id)}
                onChange={(e) => toggle("invitedRoles", r.id, e.target.checked)}
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
