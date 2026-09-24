// PROTOTYPE — throwaway. Variant B: one location per screen, its selected
// items stacked under their group headings. Next and Previous move by
// location, not by item, and the jump filter is an inline panel rather than
// a sheet - closest in feel to the Finding form, minus everything the run
// didn't select.
import { useState } from "react";
import { ItemControl } from "./ItemControl";
import { answeredCount, filterTargets, isAnswered, stepOfTarget, type RunProps } from "./wizardModel";

export const name = "Location page";

export function WizardB(p: RunProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [state, setState] = useState<"all" | "pending" | "audited">("pending");
  const step = p.steps[p.index];
  if (!step) return null;
  const t = step.target;
  const items = p.itemsFor(t);
  const answers = p.answers[t.id];
  const done = answeredCount(items, answers);
  const firstOf = (targetIndex: number) => p.steps.findIndex((s) => s.targetIndex === targetIndex);
  const prev = firstOf(step.targetIndex - 1);
  const next = firstOf(step.targetIndex + 1);
  let group = "";

  return (
    <div className="wz-layer">
      <div className="wz-topbar">
        <button type="button" className="btn btn-sm btn-bare" onClick={p.onExit}>
          ✕ Exit
        </button>
        <span className="muted small">{p.auditName}</span>
        <button type="button" className="btn btn-sm" data-testid="wz-jump" onClick={() => setOpen(!open)}>
          {open ? "Hide list" : "Jump to…"}
        </button>
      </div>

      <div className="wz-body">
        {open && (
          <div className="wz-b-jump">
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input className="input" style={{ maxWidth: 220 }} placeholder="Search…" aria-label="Search locations" value={q} onChange={(e) => setQ(e.target.value)} />
              <div className="chip-row" style={{ marginBottom: 0 }}>
                {(["pending", "audited", "all"] as const).map((f) => (
                  <button key={f} type="button" className={`chip ${state === f ? "tree-match" : ""}`} onClick={() => setState(f)}>
                    {f === "pending" ? "Still to do" : f === "audited" ? "Done" : "All"} · {filterTargets(p.targets, "", f, p.answeredTarget).length}
                  </button>
                ))}
              </div>
            </div>
            <div className="chip-row" style={{ marginTop: 8, marginBottom: 0 }}>
              {filterTargets(p.targets, q, state, p.answeredTarget).slice(0, 40).map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className={`chip ${x.id === t.id ? "tree-match" : ""}`}
                  data-testid="wz-jump-row"
                  onClick={() => {
                    p.setIndex(stepOfTarget(p.steps, x.id));
                    setOpen(false);
                  }}
                >
                  {x.location_name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="wz-b-list">
          <div className="wz-b-head">
            <h2 data-testid="wz-location">{t.location_name}</h2>
            <span className="muted small">
              {t.type_name} · {done} of {items.length} answered · location {step.targetIndex + 1} of {p.targets.length}
            </span>
          </div>
          {items.map((item) => {
            const head = item.group !== group ? item.group : null;
            group = item.group;
            const value = answers?.[item.key];
            const onFile = p.onFile(t, item);
            return (
              <div key={item.key}>
                {head && <div className="wz-b-group">{head}</div>}
                <div className={`wz-b-row ${isAnswered(value, item.kind) ? "done" : ""}`}>
                  <div className="wz-b-row-label">
                    {item.label}
                    {onFile && <span className="muted small" style={{ fontWeight: 400 }}> · on file: {onFile}</span>}
                  </div>
                  <ItemControl item={item} value={value} statuses={p.statuses} onChange={(v) => p.setAnswer(t.id, item.key, v)} />
                </div>
              </div>
            );
          })}
          <p className="muted small">{p.savedNote}</p>
        </div>
      </div>

      <div className="wz-footer">
        <button type="button" className="btn" disabled={prev === -1} onClick={() => p.setIndex(prev)}>
          ◀ Previous
        </button>
        <button
          type="button"
          className="btn btn-primary wz-grow"
          data-testid="wz-next"
          onClick={() => (next === -1 ? p.onExit() : p.setIndex(next))}
        >
          {next === -1 ? "Finish" : "Next location ▶"}
        </button>
      </div>
    </div>
  );
}
