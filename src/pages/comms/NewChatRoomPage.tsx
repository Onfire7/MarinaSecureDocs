import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { createChatRoom } from "../../data/comms";
import { useRoles, useUsers } from "../../data/users";

// Comms — New Chat Room (see docs/pages/new-chat-room.html).
// Creation is deliberately unrestricted: chat is a coordination tool, not a
// data-access surface that needs gating.
export function NewChatRoomPage() {
  const current = useCurrent();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [roleIds, setRoleIds] = useState<string[]>([]);

  const { data: users } = useUsers();
  const { roles } = useRoles();

  const create = async () => {
    if (!title.trim() || !current.user) return;
    const roomId = await createChatRoom({
      title: title.trim(),
      topic: topic.trim() || null,
      userIds,
      roleIds,
      createdById: current.user.id,
    });
    navigate(`/comms/chat/${roomId}`, { replace: true });
  };

  const toggle = (
    list: string[],
    setList: (v: string[]) => void,
    value: string,
    on: boolean,
  ) => setList(on ? [...list, value] : list.filter((x) => x !== value));

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="page-head">
        <h1 className="page-title">New chat room</h1>
      </div>

      <div className="field">
        <span className="field-label">Title — required</span>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </div>
      <div className="field">
        <span className="field-label">Topic (optional)</span>
        <input
          className="input"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </div>

      <div className="field">
        <span className="field-label">Invite users</span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {users
            .filter((u) => u.id !== current.user?.id)
            .map((u) => (
              <label key={u.id} className="row" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={userIds.includes(u.id)}
                  onChange={(e) => toggle(userIds, setUserIds, u.id, e.target.checked)}
                />
                <span className="small">{u.name}</span>
              </label>
            ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Invite roles</span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {roles.map((r) => (
            <label key={r.id} className="row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={roleIds.includes(r.id)}
                onChange={(e) => toggle(roleIds, setRoleIds, r.id, e.target.checked)}
              />
              <span className="small">{r.name}</span>
            </label>
          ))}
        </div>
        <p className="muted small" style={{ marginTop: 4 }}>
          Inviting nobody is fine — a personal scratch room is valid, and you
          can add people later.
        </p>
      </div>

      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!title.trim()}
          onClick={() => void create()}
        >
          Create room
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
