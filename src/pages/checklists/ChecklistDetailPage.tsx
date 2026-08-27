import { Fragment, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useIsMobile } from "../../hooks/useIsMobile";
import {
  itemResult,
  useInstance,
  useInstanceItems,
  useInstanceSections,
  type InstanceItemRow,
} from "../../data/checklists";
import {
  doorCheckSummary,
  questionAnswerSummary,
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

  const { instance: checklist } = useInstance(checklistId);
  const { data: sectionRows } = useInstanceSections(checklistId);
  const { data: itemRows } = useInstanceItems(checklistId);

  if (!checklist) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  // Both arrive ordered from their own queries.
  const sections = sectionRows.map((s) => ({
    ...s,
    items: itemRows.filter((i) => i.section_id === s.id),
  }));
  const items = itemRows;
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
        <h1 className="page-title">{checklist.template_name ?? "Checklist"}</h1>
      </div>

      <div className="field">
        <span className="field-label">Assigned to / completed</span>
        <div className="field-value">
          {checklist.assignee_name ?? "—"}
          {checklist.completed_at ? ` · ${timeOf(checklist.completed_at)}` : ""}
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
                    <td>{item.label ?? "—"}</td>
                    <td>{itemTypeLabel(item.type)}</td>
                    <td>
                      <ResultSummary
                        type={item.type}
                        result={itemResult(item) ?? undefined}
                      />
                    </td>
                    <td className="small">
                      {item.completed_at ? (
                        <>
                          {timeOf(item.completed_at)}
                          {item.completed_by_name && (
                            <span className="muted"> · {item.completed_by_name}</span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <LinkedTicket item={item} />
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
  items: { completed_at?: number | string | null }[];
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

function ResultCard({ item }: { item: InstanceItemRow }) {
  const type = item.type;
  return (
    <div className="card">
      <div className="badge">{itemTypeLabel(type)}</div>
      <div className="card-title">{item.label ?? "—"}</div>
      <div className="card-meta">
        <ResultSummary type={type} result={itemResult(item) ?? undefined} />
        {item.completed_at && (
          <span className="muted">
            {" · "}
            {new Date(item.completed_at).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
            {item.completed_by_name ? ` by ${item.completed_by_name}` : ""}
          </span>
        )}
      </div>
      <div style={{ marginTop: 6 }}>
        <LinkedTicket item={item} />
      </div>
      {type === "location_check" && nestedIdOf(item) && (
        <NestedChecklistSummary nestedChecklistId={nestedIdOf(item)!} />
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
    case "question":
      return (
        <span>
          {questionAnswerSummary(result as Extract<ItemResult, { type: "question" }>)}
        </span>
      );
    default:
      return <span className="muted">—</span>;
  }
}

function NestedChecklistStatus({ nestedChecklistId }: { nestedChecklistId: string }) {
  const { instance } = useInstance(nestedChecklistId);
  const status = instance?.status;
  return (
    <span>
      Nested checklist{" "}
      {status === "complete" ? "complete" : (status ?? "…").replace("_", " ")}
    </span>
  );
}

function NestedChecklistSummary({ nestedChecklistId }: { nestedChecklistId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { instance: nested } = useInstance(nestedChecklistId);
  const { data: items } = useInstanceItems(nestedChecklistId);
  if (!nested) return null;

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="btn btn-sm btn-quiet" onClick={() => setExpanded((e) => !e)}>
        {expanded ? "Hide" : "Show"} nested checklist ({nested.template_name})
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

/**
 * The ticket an item raised, if it raised one.
 *
 * Read out of the item's own result rather than from a column: the ticket's id
 * was minted when the guard described the finding, and stored there so the
 * result could reference a ticket that did not exist yet. There is no
 * linked_ticket column, and adding one would duplicate a fact the result
 * already holds.
 */
function LinkedTicket({ item }: { item: InstanceItemRow }) {
  const result = itemResult(item);
  const ticketId =
    result && "pendingTicket" in result
      ? (result as { pendingTicket?: { id: string; title: string } }).pendingTicket
      : undefined;
  if (!ticketId) return <>—</>;
  return <Link to={`/tickets/${ticketId.id}`}>{ticketId.title}</Link>;
}

function nestedIdOf(item: InstanceItemRow): string | undefined {
  const result = itemResult(item);
  return result && "nestedChecklistId" in result
    ? (result as { nestedChecklistId?: string }).nestedChecklistId
    : undefined;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
