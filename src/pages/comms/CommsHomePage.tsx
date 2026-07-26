import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { displayName } from "../../lib/contacts";
import { formatCallDuration, formatPhone, isParticipant } from "../../lib/comms";
import { NewCallDialog, NewSmsDialog } from "./NewCommsDialogs";

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

  const { data } = db.useQuery({
    calls: { contact: {}, notes: { author: {} } },
    smsThreads: { contact: {} },
    chatRooms: { createdBy: {}, invitedUsers: {}, invitedRoles: {}, messages: {} },
  });

  const calls = useMemo(
    () =>
      [...(data?.calls ?? [])].sort(
        (a, b) =>
          new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime(),
      ),
    [data],
  );
  const threads = useMemo(
    () =>
      [...(data?.smsThreads ?? [])].sort(
        (a, b) =>
          new Date(b.lastMessageAt ?? 0).getTime() -
          new Date(a.lastMessageAt ?? 0).getTime(),
      ),
    [data],
  );

  const roleIds = (current.user?.roles ?? []).map((r) => r.id);
  const { mine, others } = useMemo(() => {
    const all = data?.chatRooms ?? [];
    return {
      mine: all.filter((r) => isParticipant(r, current.user?.id, roleIds)),
      others: all.filter((r) => !isParticipant(r, current.user?.id, roleIds)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, current.user?.id, roleIds.join(",")]);

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

type CallRow = {
  id: string;
  direction: string;
  line?: string;
  fromNumber?: string;
  toNumber?: string;
  startedAt?: string | number;
  duration?: number;
  missed: boolean;
  recordingUrl?: string;
  transcript?: string;
  contact?: { id: string; name?: string | null; phone?: string | null } | null;
  notes?: { id: string; body: string; author?: { name: string } | null }[];
};

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
                  {c.contact ? displayName(c.contact) : formatPhone(c.fromNumber)}
                </span>
                <span className="card-meta">
                  {c.direction === "inbound" ? "Inbound" : "Outbound"}
                  {c.line ? ` · ${c.line}` : ""}
                  {c.missed ? " · missed" : ` · ${formatCallDuration(c.duration)}`}
                </span>
              </span>
              <span className="muted small">
                {c.startedAt
                  ? new Date(c.startedAt).toLocaleString(undefined, {
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
                {c.contact && (
                  <Link to={`/contacts/${c.contact.id}`} className="small">
                    Open contact →
                  </Link>
                )}
                {c.transcript && (
                  <p className="small" style={{ whiteSpace: "pre-wrap" }}>
                    {c.transcript}
                  </p>
                )}
                {c.recordingUrl && (
                  <audio controls src={c.recordingUrl} style={{ width: "100%" }} />
                )}
                {(c.notes ?? []).map((n) => (
                  <div key={n.id} className="small">
                    {n.body}
                    <span className="muted"> — {n.author?.name ?? "—"}</span>
                  </div>
                ))}
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

function TextsSection({
  threads,
}: {
  threads: {
    id: string;
    line?: string;
    unread: boolean;
    lastMessageAt?: string | number;
    contact?: { id: string; name?: string | null } | null;
  }[];
}) {
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
              <span className="card-title">
                {t.contact ? displayName(t.contact) : "Unknown"}
              </span>
              <span className="card-meta">{t.line ?? ""}</span>
            </span>
            <span className="row">
              {t.unread && <span className="badge badge-accent">Unread</span>}
              <span className="muted small">
                {t.lastMessageAt
                  ? new Date(t.lastMessageAt).toLocaleDateString(undefined, {
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

type RoomRow = {
  id: string;
  title: string;
  topic?: string;
  messages?: { id: string; timestamp: string | number }[];
};

function ChatSection({
  mine,
  others,
  canSeeAllChats,
}: {
  mine: RoomRow[];
  others: RoomRow[];
  canSeeAllChats: boolean;
}) {
  const lastActivity = (r: RoomRow) =>
    Math.max(0, ...(r.messages ?? []).map((m) => new Date(m.timestamp).getTime()));
  const sortRooms = (rooms: RoomRow[]) =>
    [...rooms].sort((a, b) => lastActivity(b) - lastActivity(a));

  const roomCard = (r: RoomRow) => (
    <Link
      key={r.id}
      to={`/comms/chat/${r.id}`}
      className="card spread"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <span>
        <span className="card-title">{r.title}</span>
        {r.topic && <span className="card-meta">{r.topic}</span>}
      </span>
      <span className="muted small">
        {(r.messages ?? []).length} msg
        {(r.messages ?? []).length === 1 ? "" : "s"}
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
