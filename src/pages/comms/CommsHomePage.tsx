import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { formatCallDuration, formatPhone, isParticipant } from "../../lib/comms";
import { NewCallDialog, NewSmsDialog } from "./NewCommsDialogs";
import {
  useCallNotes,
  useCalls,
  useChatRooms,
  useChatRoomRoles,
  useChatRoomUsers,
  useSmsThreads,
  type CallRow,
  type ChatRoomRow,
  type SmsThreadRow,
} from "../../data/comms";
import { useRoleIdsFor } from "../../data/users";

// Comms — Home (see docs/pages/comms-home.html).
// Three independently gated sections: view_calls, view_sms, and chat (always
// visible for one's own rooms). place_calls is separate again and governs
// only *initiating* — a marina can have staff who browse history without
// placing calls, or the reverse.
type Tab = "calls" | "texts" | "chat";

export function CommsHomePage() {
  const current = useCurrent();
  const isMobile = useIsMobile();
  const canCalls = current.can("view_calls");
  const canSms = current.can("view_sms");
  const canPlace = current.can("place_calls");
  const canSeeAllChats = current.can("view_all_chats");
  const [tab, setTab] = useState<Tab>(canCalls ? "calls" : canSms ? "texts" : "chat");
  const [dialog, setDialog] = useState<"call" | "sms" | null>(null);

  // Each list comes back already ordered by its own query. Every one of them
  // is empty on a device without the matching permission, because the rows
  // were never synced — the `can` checks decide which SECTION appears, not
  // which rows are in it.
  const { data: calls } = useCalls();
  const { data: threads } = useSmsThreads();
  const { data: rooms } = useChatRooms();
  const { data: roomUsers } = useChatRoomUsers();
  const { data: roomRoles } = useChatRoomRoles();
  const roleIds = useRoleIdsFor(current.user?.id);

  const { mine, others } = useMemo(() => {
    const withInvites = rooms.map((r) => ({
      ...r,
      invitedUserIds: roomUsers.filter((u) => u.room_id === r.id).map((u) => u.user_id),
      invitedRoleIds: roomRoles.filter((x) => x.room_id === r.id).map((x) => x.role_id),
    }));
    return {
      mine: withInvites.filter((r) => isParticipant(r, current.user?.id, roleIds)),
      others: withInvites.filter((r) => !isParticipant(r, current.user?.id, roleIds)),
    };
  }, [rooms, roomUsers, roomRoles, current.user?.id, roleIds]);

  const tabs: Tab[] = [
    ...(canCalls ? (["calls"] as Tab[]) : []),
    ...(canSms ? (["texts"] as Tab[]) : []),
    "chat",
  ];

  const callsSection = canCalls && <CallsSection calls={calls} />;
  const textsSection = canSms && <TextsSection threads={threads} />;
  const chatSection = (
    <ChatSection mine={mine} others={others} canSeeAllChats={canSeeAllChats} />
  );

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Comms</h1>
        <div className="row">
          {canPlace && (
            <>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setDialog("call")}
              >
                + Call
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setDialog("sms")}
              >
                + Text
              </button>
            </>
          )}
          <Link to="/comms/chat/new" className="btn btn-sm btn-primary">
            + Chat room
          </Link>
        </div>
      </div>

      {isMobile ? (
        <>
          <div className="chip-row">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                className={"chip" + (tab === t ? " active" : "")}
                onClick={() => setTab(t)}
              >
                {t === "calls" ? "Calls" : t === "texts" ? "Texts" : "Chat"}
              </button>
            ))}
          </div>
          {tab === "calls" && callsSection}
          {tab === "texts" && textsSection}
          {tab === "chat" && chatSection}
        </>
      ) : (
        <div className="comms-columns">
          {callsSection}
          {textsSection}
          {chatSection}
        </div>
      )}

      {dialog === "call" && <NewCallDialog onClose={() => setDialog(null)} />}
      {dialog === "sms" && <NewSmsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function CallsSection({ calls }: { calls: CallRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div>
      <div className="section-title">Recent calls</div>
      <div className="stack" style={{ gap: 6 }}>
        {calls.slice(0, 25).map((c) => (
          <div key={c.id} className="card">
            <button
              type="button"
              className="spread"
              style={{
                all: "unset",
                display: "flex",
                width: "100%",
                cursor: "pointer",
                justifyContent: "space-between",
              }}
              onClick={() => setExpanded(expanded === c.id ? null : c.id)}
            >
              <span>
                <span className="card-title">
                  {c.contact_name ?? formatPhone(c.from_number)}
                </span>
                <span className="card-meta">
                  {c.direction === "inbound" ? "Inbound" : "Outbound"}
                  {c.line ? ` · ${c.line}` : ""}
                  {c.missed === 1
                    ? " · missed"
                    : ` · ${formatCallDuration(c.duration)}`}
                </span>
              </span>
              <span className="muted small">
                {c.started_at
                  ? new Date(c.started_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "—"}
              </span>
            </button>

            {/* Expands inline rather than opening a separate detail page. */}
            {expanded === c.id && (
              <div style={{ marginTop: 8 }}>
                {c.contact_id && (
                  <Link to={`/contacts/${c.contact_id}`} className="small">
                    Open contact →
                  </Link>
                )}
                {c.transcript && (
                  <p className="small" style={{ whiteSpace: "pre-wrap" }}>
                    {c.transcript}
                  </p>
                )}
                {c.recording_url && (
                  <audio controls src={c.recording_url} style={{ width: "100%" }} />
                )}
                <CallNotes callId={c.id} />
              </div>
            )}
          </div>
        ))}
        {calls.length === 0 && (
          <span className="muted small">
            No calls recorded. Call history arrives via the Twilio bridge.
          </span>
        )}
      </div>
    </div>
  );
}

function CallNotes({ callId }: { callId: string }) {
  // Fetched per expanded call rather than joined into the list: only one call
  // is open at a time, and a join would pull every note on every call in the
  // history to render none of them.
  const { data: notes } = useCallNotes(callId);
  return (
    <>
      {notes.map((n) => (
        <div key={n.id} className="small">
          {n.body}
          <span className="muted"> — {n.author_name ?? "—"}</span>
        </div>
      ))}
    </>
  );
}

function TextsSection({ threads }: { threads: SmsThreadRow[] }) {
  return (
    <div>
      <div className="section-title">Recent texts</div>
      <div className="stack" style={{ gap: 6 }}>
        {threads.slice(0, 25).map((t) => (
          <Link
            key={t.id}
            to={`/comms/sms/${t.id}`}
            className="card spread"
            style={{ textDecoration: "none", color: "inherit" }}
          >
            <span>
              <span className="card-title">{t.contact_name ?? "Unknown"}</span>
              <span className="card-meta">{t.line ?? ""}</span>
            </span>
            <span className="row">
              {t.unread === 1 && <span className="badge badge-accent">Unread</span>}
              <span className="muted small">
                {t.last_message_at
                  ? new Date(t.last_message_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })
                  : ""}
              </span>
            </span>
          </Link>
        ))}
        {threads.length === 0 && (
          <span className="muted small">
            No text threads. SMS arrives via the Twilio bridge.
          </span>
        )}
      </div>
    </div>
  );
}

function ChatSection({
  mine,
  others,
  canSeeAllChats,
}: {
  mine: ChatRoomRow[];
  others: ChatRoomRow[];
  canSeeAllChats: boolean;
}) {
  // last_message_at and message_count come back on the row, so the sort is a
  // comparison rather than a scan of every room's messages.
  const sortRooms = (rooms: ChatRoomRow[]) =>
    [...rooms].sort((a, b) =>
      (b.last_message_at ?? "").localeCompare(a.last_message_at ?? ""),
    );

  const roomCard = (r: ChatRoomRow) => (
    <Link
      key={r.id}
      to={`/comms/chat/${r.id}`}
      className="card spread"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <span>
        <span className="card-title">{r.title ?? "Chat"}</span>
        {r.topic && <span className="card-meta">{r.topic}</span>}
      </span>
      <span className="muted small">
        {r.message_count} msg{r.message_count === 1 ? "" : "s"}
      </span>
    </Link>
  );

  return (
    <div>
      <div className="section-title">My chat rooms</div>
      <div className="stack" style={{ gap: 6 }}>
        {sortRooms(mine).map(roomCard)}
        {mine.length === 0 && (
          <span className="muted small">
            You're not in any rooms yet — start one above.
          </span>
        )}
      </div>

      {/* Kept visually separate, never merged into one list. */}
      {canSeeAllChats && (
        <>
          <div className="section-title" style={{ marginTop: 16 }}>
            Other chat rooms
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {sortRooms(others).map(roomCard)}
            {others.length === 0 && (
              <span className="muted small">No other rooms.</span>
            )}
          </div>
          <p className="muted small" style={{ marginTop: 6 }}>
            Read-only unless you join.
          </p>
        </>
      )}
    </div>
  );
}
