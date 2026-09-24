// PROTOTYPE — throwaway. The filterable location picker, as a bottom sheet
// (A and C use it; B has the same filter inline instead).
import { useState } from "react";
import { answeredCount, filterTargets, type RunProps, type WizardTarget } from "./wizardModel";

export function JumpSheet({
  targets,
  itemsFor,
  answers,
  answeredTarget,
  currentTargetId,
  onPick,
  onClose,
}: Pick<RunProps, "targets" | "itemsFor" | "answers" | "answeredTarget"> & {
  currentTargetId: string;
  onPick: (t: WizardTarget) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<"all" | "pending" | "audited">("pending");
  const shown = filterTargets(targets, q, state, answeredTarget);
  return (
    <div className="wz-sheet-backdrop" onClick={onClose}>
      <div className="wz-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="wz-sheet-head">
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <b>Jump to a location</b>
            <button type="button" className="btn btn-sm btn-bare" style={{ marginLeft: "auto" }} onClick={onClose}>
              ✕
            </button>
          </div>
          <input className="input" placeholder="Search…" aria-label="Search locations" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="chip-row" style={{ marginBottom: 0 }}>
            {(["pending", "audited", "all"] as const).map((f) => (
              <button key={f} type="button" className={`chip ${state === f ? "tree-match" : ""}`} onClick={() => setState(f)}>
                {f === "pending" ? "Still to do" : f === "audited" ? "Done" : "All"} ·{" "}
                {filterTargets(targets, "", f, answeredTarget).length}
              </button>
            ))}
          </div>
        </div>
        <div className="wz-sheet-list">
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
      </div>
    </div>
  );
}
