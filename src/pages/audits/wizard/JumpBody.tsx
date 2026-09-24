// The filterable location list, in the phone's bottom sheet and in the
// desktop sidebar (AuditWizardPage.spec.md § Jumping).
import { useState } from "react";
import { answeredCount, filterTargets, type WizardTarget } from "../../../lib/auditWizard";
import type { RunProps } from "./runProps";

export function JumpBody({
  targets,
  itemsFor,
  answers,
  answeredTarget,
  currentTargetId,
  onPick,
}: Pick<RunProps, "targets" | "itemsFor" | "answers" | "answeredTarget"> & {
  currentTargetId: string;
  onPick: (t: WizardTarget) => void;
}) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<"all" | "pending" | "audited">("pending");
  const shown = filterTargets(targets, q, state, answeredTarget);
  return (
    <>
      <div className="wz-jump-filter">
        <input className="input" placeholder="Search…" aria-label="Search locations" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="chip-row" style={{ marginBottom: 0 }}>
          {(["pending", "audited", "all"] as const).map((f) => (
            <button key={f} type="button" className={`chip ${state === f ? "tree-match" : ""}`} onClick={() => setState(f)}>
              {f === "pending" ? "Still to do" : f === "audited" ? "Done" : "All"} · {filterTargets(targets, "", f, answeredTarget).length}
            </button>
          ))}
        </div>
      </div>
      <div className="wz-jump-rows">
        {shown.map((t) => {
          const items = itemsFor(t);
          const done = answeredCount(items, answers[t.id]);
          return (
            <button
              key={t.id}
              type="button"
              className={`wz-jump-row ${t.id === currentTargetId ? "now" : ""}`}
              data-testid="wz-jump-row"
              onClick={() => onPick(t)}
            >
              <b>{t.location_name}</b>
              <span className="muted small">{t.type_name}</span>
              <span className="muted">
                {done > 0 ? `${done} of ${items.length}` : t.state === "audited" ? "audited" : `${items.length} items`}
              </span>
            </button>
          );
        })}
        {shown.length === 0 && <p className="muted small" style={{ padding: "10px 14px" }}>Nothing matches.</p>}
      </div>
    </>
  );
}
