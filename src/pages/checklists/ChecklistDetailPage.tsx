import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useIsMobile } from "../../hooks/useIsMobile";
import { doorCheckSummary, itemTypeLabel, type ItemResult } from "../../lib/checklists";

// Checklists & Tours — Checklist Detail (see pages/checklist-detail.html).
// Read-only record of a completed instance — no edit actions anywhere.
export function ChecklistDetailPage() {
  const { id: checklistId } = useParams();
  const isMobile = useIsMobile();

  const { data } = db.useQuery(
    checklistId
      ? {
          checklists: {
            $: { where: { id: checklistId } },
            template: { items: {} },
            itemResults: { templateItem: {}, linkedTicket: {} },
            assignedTo: {},
          },
        }
      : null,
  );
  const checklist = data?.checklists?.[0];

  if (!checklist) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const items = (checklist.template?.items ?? [])
    .slice()
    .sort((a, b) => a.order - b.order);
  const resultByItemId = new Map(
    (checklist.itemResults ?? []).map((r) => [r.templateItem?.id, r]),
  );

  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">{checklist.template?.name ?? "Checklist"}</h1>
      </div>

      <div className="field">
        <span className="field-label">Assigned to / completed</span>
        <div className="field-value">
          {checklist.assignedTo?.name ?? "—"}
          {checklist.completedAt
            ? ` · ${new Date(checklist.completedAt).toLocaleString(undefined, {
                hour: "numeric",
                minute: "2-digit",
                month: "short",
                day: "numeric",
              })}`
            : ""}
        </div>
      </div>

      {isMobile ? (
        <div className="stack">
          {items.map((item) => (
            <ResultCard key={item.id} type={item.type} label={item.label} result={resultByItemId.get(item.id)} />
          ))}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th>Result</th>
              <th>Linked ticket</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const r = resultByItemId.get(item.id);
              return (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td>{itemTypeLabel(item.type)}</td>
                  <td>
                    <ResultSummary type={item.type} result={r?.result as ItemResult | undefined} />
                  </td>
                  <td>
                    {r?.linkedTicket ? (
                      <Link to={`/tickets/${r.linkedTicket.id}`}>{r.linkedTicket.title}</Link>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
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

function ResultCard({
  type,
  label,
  result,
}: {
  type: string;
  label: string;
  result: { result?: unknown; linkedTicket?: { id: string; title: string } } | undefined;
}) {
  return (
    <div className="card">
      <div className="badge">{itemTypeLabel(type)}</div>
      <div className="card-title">{label}</div>
      <div className="card-meta">
        <ResultSummary type={type} result={result?.result as ItemResult | undefined} />
      </div>
      {result?.linkedTicket && (
        <div style={{ marginTop: 6 }}>
          <Link to={`/tickets/${result.linkedTicket.id}`}>{result.linkedTicket.title}</Link>
        </div>
      )}
      {type === "location_check" && result?.result != null && (
        <NestedChecklistSummary
          nestedChecklistId={(result.result as { nestedChecklistId: string }).nestedChecklistId}
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
  const { data } = db.useQuery({ checklists: { $: { where: { id: nestedChecklistId } } } });
  const status = data?.checklists?.[0]?.status;
  return <span>Nested checklist {status === "complete" ? "complete" : (status ?? "…").replace("_", " ")}</span>;
}

function NestedChecklistSummary({ nestedChecklistId }: { nestedChecklistId: string }) {
  const [expanded, setExpanded] = useState(false);
  const { data } = db.useQuery({
    checklists: {
      $: { where: { id: nestedChecklistId } },
      template: { items: {} },
      itemResults: { templateItem: {}, linkedTicket: {} },
    },
  });
  const nested = data?.checklists?.[0];
  if (!nested) return null;
  const items = (nested.template?.items ?? []).slice().sort((a, b) => a.order - b.order);
  const resultByItemId = new Map((nested.itemResults ?? []).map((r) => [r.templateItem?.id, r]));

  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="btn btn-sm btn-quiet" onClick={() => setExpanded((e) => !e)}>
        {expanded ? "Hide" : "Show"} nested checklist ({nested.template?.name})
      </button>
      {expanded && (
        <div className="stack" style={{ marginTop: 8 }}>
          {items.map((item) => (
            <ResultCard
              key={item.id}
              type={item.type}
              label={item.label}
              result={resultByItemId.get(item.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
