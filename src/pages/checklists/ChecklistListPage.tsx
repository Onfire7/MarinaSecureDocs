import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { triggeredByLabel, type TriggeredBy } from "../../lib/checklists";
import { ManualCheckinDialog } from "./ManualCheckinDialog";

// Checklists & Tours — Checklist List (see pages/checklist-list.html).
// Everything currently relevant to the signed-in user: assigned to them
// directly, or unclaimed and assigned to a role they hold. Security also
// gets a Tours panel/tab.
type StatusFilter = "all" | "not_started" | "in_progress" | "complete";

export function ChecklistListPage() {
  const current = useCurrent();
  const userId = current.user?.id;
  const isSecurity = current.roleNames.includes("Security");
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [mobileTab, setMobileTab] = useState<"checklists" | "tours">("checklists");
  const [showManualCheckin, setShowManualCheckin] = useState(false);
  const showChecklists = !isMobile || mobileTab === "checklists";
  const showTours = isSecurity && (!isMobile || mobileTab === "tours");

  const roleIds = (current.user?.roles ?? []).map((r) => r.id);

  const { data: mineData } = db.useQuery(
    userId
      ? {
          checklists: {
            $: { where: { "assignedTo.id": userId } },
            template: {},
          },
        }
      : null,
  );
  const { data: unclaimedData } = db.useQuery(
    roleIds.length > 0
      ? {
          checklists: {
            $: {
              where: {
                assignedTo: { $isNull: true },
                status: { $in: ["not_started", "in_progress"] },
                "template.role.id": { $in: roleIds },
              },
            },
            template: {},
          },
        }
      : null,
  );

  const checklists = useMemo(() => {
    const mine = mineData?.checklists ?? [];
    const unclaimed = unclaimedData?.checklists ?? [];
    const seen = new Set(mine.map((c) => c.id));
    return [...mine, ...unclaimed.filter((c) => !seen.has(c.id))];
  }, [mineData, unclaimedData]);

  const checkpointIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of checklists) {
      const t = c.triggeredBy as TriggeredBy | undefined;
      if (t?.type === "checkpoint") ids.add(t.checkpointId);
    }
    return [...ids];
  }, [checklists]);
  const { data: cpData } = db.useQuery(
    checkpointIds.length > 0
      ? { checkpoints: { $: { where: { id: { $in: checkpointIds } } } } }
      : null,
  );
  const checkpointNameById = new Map(
    (cpData?.checkpoints ?? []).map((c) => [c.id, c.name]),
  );

  const filtered = checklists
    .filter((c) => filter === "all" || c.status === filter)
    .sort((a, b) => {
      const rank = (s: string) => (s === "in_progress" ? 0 : s === "not_started" ? 1 : 2);
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      return (b.startedAt ?? 0) > (a.startedAt ?? 0) ? 1 : -1;
    });

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Checklists</h1>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setShowManualCheckin(true)}
        >
          Check in manually
        </button>
      </div>

      <div className="chip-row">
        <button
          type="button"
          className={"chip" + (filter === "all" ? " active" : "")}
          onClick={() => setFilter("all")}
        >
          All
        </button>
        <button
          type="button"
          className={"chip" + (filter === "in_progress" ? " active" : "")}
          onClick={() => setFilter("in_progress")}
        >
          In Progress
        </button>
        <button
          type="button"
          className={"chip" + (filter === "not_started" ? " active" : "")}
          onClick={() => setFilter("not_started")}
        >
          Not Started
        </button>
        <button
          type="button"
          className={"chip" + (filter === "complete" ? " active" : "")}
          onClick={() => setFilter("complete")}
        >
          Complete
        </button>
        {isSecurity && isMobile && (
          <button
            type="button"
            className={"chip" + (mobileTab === "tours" ? " active" : "")}
            style={{ marginLeft: "auto" }}
            onClick={() => setMobileTab(mobileTab === "tours" ? "checklists" : "tours")}
          >
            Tours
          </button>
        )}
      </div>

      <div className={isSecurity ? "grid-2" : undefined}>
        {showChecklists && (
          <div>
            <table className="table table-mobile-cards">
              <thead>
                <tr>
                  <th>Template</th>
                  <th>Status</th>
                  <th>Trigger</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Template">
                      <Link to={`/checklists/${c.id}`}>
                        {c.template?.name ?? "Checklist"}
                      </Link>
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={c.status} />
                    </td>
                    <td data-label="Trigger" className="muted small">
                      {triggeredByLabel(
                        c.triggeredBy as TriggeredBy | undefined,
                        (c.triggeredBy as TriggeredBy | undefined)?.type === "checkpoint"
                          ? checkpointNameById.get(
                              (c.triggeredBy as { checkpointId: string }).checkpointId,
                            )
                          : undefined,
                      )}
                    </td>
                    <td data-label="Started" className="muted small">
                      {c.startedAt
                        ? new Date(c.startedAt).toLocaleString(undefined, {
                            hour: "numeric",
                            minute: "2-digit",
                            month: "short",
                            day: "numeric",
                          })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filtered.length === 0 && (
              <div className="placeholder">
                <div className="big">
                  {checklists.length === 0
                    ? "Nothing assigned right now"
                    : "No checklists match this filter"}
                </div>
                {checklists.length === 0 &&
                  (roleIds.length === 0
                    ? "You hold no roles with checklist assignments."
                    : "Check back once a checkpoint visit, schedule, or clock event triggers one.")}
              </div>
            )}
          </div>
        )}

        {showTours && (
          <div>
            <ToursPanel />
          </div>
        )}
      </div>

      {showManualCheckin && (
        <ManualCheckinDialog onClose={() => setShowManualCheckin(false)} />
      )}
    </div>
  );
}

function ToursPanel() {
  const { data } = db.useQuery({ tours: { checkpoints: {} } });
  const tours = data?.tours ?? [];
  return (
    <div>
      <div className="section-title">
        Tours <span className="badge badge-accent">Security</span>
      </div>
      {tours.length === 0 && (
        <div className="placeholder">
          <div className="big">No tours configured</div>
          Set these up in Admin → Tours setup.
        </div>
      )}
      <div className="stack">
        {tours.map((t) => (
          <Link key={t.id} to={`/checklists/tours/${t.id}`} className="card" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="card-title">{t.name}</div>
            <div className="card-meta">
              {modeLabel(t.mode)} · {(t.checkpoints ?? []).length} checkpoints
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function modeLabel(mode: string): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "complete"
      ? "badge badge-good"
      : status === "in_progress"
        ? "badge badge-warn"
        : "badge";
  const label =
    status === "complete"
      ? "Complete"
      : status === "in_progress"
        ? "In Progress"
        : "Not Started";
  return <span className={cls}>{label}</span>;
}
