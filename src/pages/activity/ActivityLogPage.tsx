import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import {
  SUBJECT_LABEL,
  subjectPath,
  subjectPermission,
  type SubjectType,
} from "../../lib/activityLog";

// Activity Log — Feed (see docs/pages/activity-log.html).
// No single "view activity log" permission: each entry is scoped by whatever
// permission governs its subject, and an entry the viewer couldn't otherwise
// see is omitted entirely rather than redacted.
export function ActivityLogPage() {
  const current = useCurrent();
  const canProtect = current.can("manage_marina_settings");
  const [searchParams] = useSearchParams();
  const [typeFilter, setTypeFilter] = useState<string>(
    searchParams.get("subjectType") ?? "",
  );
  const [actorFilter, setActorFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [limit, setLimit] = useState(100);

  // Deep links from a subject's own page (e.g. Checkpoint detail's "full
  // history") pre-filter to that record.
  const subjectIdFilter = searchParams.get("subjectId");

  const { data } = db.useQuery({
    activityLogEntries: {
      $: { order: { timestamp: "desc" }, limit },
      actor: {},
    },
    users: { $: { where: { active: true } } },
  });

  const entries = useMemo(() => data?.activityLogEntries ?? [], [data]);
  const users = data?.users ?? [];

  // Per-entry gating, applied before any user-facing filter — so no filter
  // can surface something otherwise invisible.
  const visible = useMemo(
    () =>
      entries.filter((e) => {
        const required = subjectPermission(e.subjectType);
        return !required || current.can(required);
      }),
    [entries, current],
  );

  const subjectTypes = useMemo(
    () => [...new Set(visible.map((e) => e.subjectType))].sort(),
    [visible],
  );

  const filtered = visible.filter((e) => {
    if (subjectIdFilter && e.subjectId !== subjectIdFilter) return false;
    if (typeFilter && e.subjectType !== typeFilter) return false;
    if (actorFilter) {
      if (actorFilter === "system" ? e.actor : e.actor?.id !== actorFilter) return false;
    }
    const ts = new Date(e.timestamp).getTime();
    if (fromDate && ts < new Date(fromDate).getTime()) return false;
    if (toDate && ts > new Date(toDate).getTime() + 24 * 3600_000) return false;
    return true;
  });

  const toggleProtected = (entryId: string, next: boolean) => {
    // The Activity Log never logs its own writes (see docs/architecture.md).
    void db.transact(db.tx.activityLogEntries[entryId].update({ protected: next }));
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Activity Log</h1>
          <div className="page-sub">
            Scoped to what you have permission to see
          </div>
        </div>
      </div>

      {subjectIdFilter && (
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="badge badge-accent">Filtered to one record</span>
          <Link to="/activity" className="small">
            Clear
          </Link>
        </div>
      )}

      <div className="chip-row">
        <select
          className="select select-inline"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All types</option>
          {subjectTypes.map((t) => (
            <option key={t} value={t}>
              {SUBJECT_LABEL[t as SubjectType] ?? t}
            </option>
          ))}
        </select>
        <select
          className="select select-inline"
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
        >
          <option value="">Anyone</option>
          <option value="system">System</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="input select-inline"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          title="From"
        />
        <input
          type="date"
          className="input select-inline"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          title="To"
        />
      </div>

      <div className="stack" style={{ gap: 6 }}>
        {filtered.map((e) => {
          const path = subjectPath(e.subjectType, e.subjectId);
          return (
            <div key={e.id} className="card spread" style={{ flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div>
                  {path ? <Link to={path}>{e.summary}</Link> : e.summary}
                  {canProtect && e.protected && (
                    <span className="badge badge-accent" style={{ marginLeft: 8 }}>
                      Protected
                    </span>
                  )}
                </div>
                <div className="card-meta">
                  <span className="badge">
                    {SUBJECT_LABEL[e.subjectType as SubjectType] ?? e.subjectType}
                  </span>{" "}
                  <code className="small">{e.eventType}</code> ·{" "}
                  {/* A null actor is a system-generated event, not a blank. */}
                  {e.actor?.name ?? "System"}
                </div>
              </div>
              <div className="row">
                <span className="muted small">
                  {new Date(e.timestamp).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                {canProtect && (
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    title="Protected entries survive the retention purge"
                    onClick={() => toggleProtected(e.id, !e.protected)}
                  >
                    {e.protected ? "Unprotect" : "Protect"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="placeholder">
            <div className="big">
              {visible.length === 0 ? "No activity recorded yet" : "Nothing matches"}
            </div>
            {visible.length === 0 &&
              "Entries are written as changes happen — take an action anywhere in the app and it appears here."}
          </div>
        )}
      </div>

      {filtered.length > 0 && entries.length >= limit && (
        <div className="row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setLimit(limit + 100)}
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
