import { Fragment, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useIsMobile } from "../../hooks/useIsMobile";
import {
  doorCheckSummary,
  itemTypeLabel,
  sectionCompletionTime,
  type ItemResult,
} from "../../lib/checklists";

// Checklists & Tours — Checklist Detail (see pages/checklist-detail.html).
// Read-only record of a completed instance — no edit actions anywhere. An
// instance is fully materialized rows, so this renders exactly what was
// assigned: every section that existed, every item, whoever completed each
// and when. Section completion times are derived here (latest item, once
// all are done) rather than stored.
export function ChecklistDetailPage() {
  const { id: checklistId } = useParams();
  const isMobile = useIsMobile();

  const { data } = db.useQuery(
    checklistId
      ? {
          checklistInstances: {
            $: { where: { id: checklistId } },
            template: {},
            sections: {
              items: { template: {}, linkedTicket: {}, completedBy: {} },
            },
            assignedTo: {},
          },
        }
      : null,
  );
  const checklist = data?.checklistInstances?.[0];

  if (!checklist) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;
  const sections = (checklist.sections ?? [])
    .slice()
    .sort(byOrder)
    .map((s) => ({ ...s, items: (s.items ?? []).slice().sort(byOrder) }));
  const items = sections.flatMap((s) => s.items);
  const showSectionHeadings = sections.length > 1;

  const timeOf = (ts: number | string | null | undefined) =>
    ts
      ? new Date(ts).toLocaleString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          month: "short",
          day: "numeric",
        })
      : null;

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{checklist.template?.name ?? "Checklist"}</h1>
      </div>

      <div className="field">
        <span className="field-label">Assigned to / completed</span>
        <div className="field-value">
          {checklist.assignedTo?.name ?? "—"}
          {checklist.completedAt ? ` · ${timeOf(checklist.completedAt)}` : ""}
        </div>
      </div>

      {isMobile ? (
        <div className="stack">
          {sections.map((section) => (
            <Fragment key={section.id}>
              {showSectionHeadings && (
                <div className="group-heading">
                  <span>
                    {section.label}
                    <SectionCompletion items={section.items} />
                  </span>
                </div>
              )}
              {section.items.map((item) => (
                <ResultCard key={item.id} item={item} />
              ))}
            </Fragment>
          ))}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th>Result</th>
              <th>Completed</th>
              <th>Linked ticket</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((section) => (
              <Fragment key={section.id}>
                {showSectionHeadings && (
                  <tr>
                    <th colSpan={5} className="group-heading">
                      {section.label}
                      <SectionCompletion items={section.items} />
                    </th>
                  </tr>
                )}
                {section.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.template?.label ?? "—"}</td>
                    <td>{item.template ? itemTypeLabel(item.template.type) : "—"}</td>
                    <td>
                      <ResultSummary
                        type={item.template?.type ?? ""}
                        result={item.result as ItemResult | undefined}
                      />
                    </td>
                    <td className="small">
                      {item.completedAt ? (
                        <>
                          {timeOf(item.completedAt)}
                          {item.completedBy && (
                            <span className="muted"> · {item.completedBy.name}</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {item.linkedTicket ? (
                        <Link to={`/tickets/${item.linkedTicket.id}`}>
                          {item.linkedTicket.title}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}

      {items.length === 0 && (
        <div className="placeholder">
          <div className="big">No items on this checklist</div>
        </div>
      )}
    </div>
  );
}

/**
 * Derived, not stored: the section finished when its last item did — and
 * only once every item has a completion time.
 */
function SectionCompletion({
  items,
}: {
  items: { completedAt?: number | string | null }[];
}) {
  const done = sectionCompletionTime(items);
  if (done == null) return null;
  return (
    <span className="muted small">
      {" · completed "}
      {new Date(done).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })}
    </span>
  );
}

interface ItemRowLike {
  id: string;
  result?: unknown;
  completedAt?: number | string | null;
  completedBy?: { name: string } | null;
  linkedTicket?: { id: string; title: string } | null;
  template?: { type: string; label: string } | null;
}

function ResultCard({ item }: { item: ItemRowLike }) {
  const type = item.template?.type ?? "";
  return (
    <div className="card">
      <div className="badge">{itemTypeLabel(type)}</div>
      <div className="card-title">{item.template?.label ?? "—"}</div>
      <div className="card-meta">
        <ResultSummary type={type} result={item.result as ItemResult | undefined} />
        {item.completedAt && (
          <span className="muted">
            {" · "}
            {new Date(item.completedAt).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
            {item.completedBy ? ` by ${item.completedBy.name}` : ""}
          </span>
        )}
      </div>
      {item.linkedTicket && (
        <div style={{ marginTop: 6 }}>
          <Link to={`/tickets/${item.linkedTicket.id}`}>{item.linkedTicket.title}</Link>
        </div>
      )}
      {type === "location_check" && item.result != null && (
        <NestedChecklistSummary
          nestedChecklistId={(item.result as { nestedChecklistId: string }).nestedChecklistId}
        />
      )}
    </div>
  );
}

function ResultSummary({ type, result }: { type: string; result: ItemResult | undefined }) {
  if (!result) return <span className="muted">Not recorded</span>;
  switch (type) {
    case "simple_check":
      return <span>Complete</span>;
    case "verify_task": {
      const r = result as Extract<ItemResult, { type: "verify_task" }>;
      if (r.outcome === "confirmed") return <span>Confirmed{r.attempted ? " (after attempt)" : ""}</span>;
      if (r.outcome === "rejected_reason") return <span>Rejected — {r.reason ?? "reason given"}</span>;
      return <span>Rejected — ticket raised</span>;
    }
    case "door_check":
    case "lock_check":
    case "gas_pump_check": { // legacy type string, pre-rename
      const s = doorCheckSummary(result as Extract<ItemResult, { type: "door_check" }>);
      // Found and left are reported as separate facts: a door corrected on
      // arrival still means it was insecure until the guard got there.
      if (!s.foundKnown) {
        return (
          <span>
            {s.final ? capitalize(s.final) : "—"}
            {s.final ? (s.leftAsExpected ? " (matched)" : " — mismatch") : ""}
          </span>
        );
      }
      return (
        <span>
          Found {s.initial} → left {s.final}
          {s.foundAsExpected
            ? " (as expected)"
            : s.corrected
              ? " (corrected)"
              : " — still not as expected"}
          {s.note ? `: "${s.note}"` : ""}
        </span>
      );
    }
    case "location_check":
      return <NestedChecklistStatus nestedChecklistId={(result as Extract<ItemResult, { type: "location_check" }>).nestedChecklistId} />;
    case "meter_reading": {
      const r = result as Extract<ItemResult, { type: "meter_reading" }>;
      return <span>Recorded {r.value}</span>;
    }
    default:
      return <span className="muted">—</span>;
  }
}

function NestedChecklistStatus({ nestedChecklistId }: { nestedChecklistId: string }) {
  const { data } = db.useQuery({
    checklistInstances: { $: { where: { id: nestedChecklistId } } },
  });
  const status = data?.checklistInstances?.[0]?.status;
  return <span>Nested checklist {status === "complete" ? "complete" : (status ?? "…").replace("_", " ")}</span>;
}

function NestedChecklistSummary({ nestedChecklistId }: { nestedChecklistId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data } = db.useQuery({
    checklistInstances: {
      $: { where: { id: nestedChecklistId } },
      template: {},
      sections: {
        items: { template: {}, linkedTicket: {}, completedBy: {} },
      },
    },
  });
  const nested = data?.checklistInstances?.[0];
  if (!nested) return null;
  const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;
  const items = (nested.sections ?? [])
    .slice()
    .sort(byOrder)
    .flatMap((s) => (s.items ?? []).slice().sort(byOrder));

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="btn btn-sm btn-quiet" onClick={() => setExpanded((e) => !e)}>
        {expanded ? "Hide" : "Show"} nested checklist ({nested.template?.name})
      </button>
      {expanded && (
        <div className="stack" style={{ marginTop: 8 }}>
          {items.map((item) => (
            <ResultCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
