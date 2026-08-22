import { useMemo, useState } from "react";
import {
  DEFAULT_GENERATOR,
  generateNames,
  type CounterMode,
  type GeneratorOptions,
} from "../../lib/nameGenerator";

// Composes a name list from prefix(es) + a counter + suffix(es) — e.g.
// "BH-A-" × 5…10 × "L,R" gives BH-A-5L … BH-A-10R. Accepting it fills the
// create dialog's name list rather than creating anything directly, so gaps
// in a series (a slip that doesn't exist) can be deleted before committing.
//
// The composition itself lives in lib/nameGenerator so the setup wizard
// applies identical semantics; this file is only the dialog around it.

export function NameGeneratorDialog({
  onInsert,
  onClose,
}: {
  onInsert: (names: string[]) => void;
  onClose: () => void;
}) {
  const [opts, setOpts] = useState<GeneratorOptions>(DEFAULT_GENERATOR);

  const names = useMemo(() => generateNames(opts), [opts]);
  const set = (patch: Partial<GeneratorOptions>) => setOpts({ ...opts, ...patch });

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-card"
        style={{ maxWidth: 620 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-title" style={{ marginBottom: 4 }}>
          Generate names
        </div>
        <p className="muted small">
          Each part is optional and comma-separated fields produce every
          combination — "BH-A-" with 5–10 and "L,R" gives BH-A-5L through
          BH-A-10R.
        </p>

        <div className="field">
          <span className="field-label">Prefix — comma-separate for several</span>
          <input
            className="input"
            value={opts.prefixes}
            onChange={(e) => set({ prefixes: e.target.value })}
            placeholder="BH-A-"
            autoFocus
          />
        </div>

        <div className="field">
          <span className="field-label">Counter</span>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <select
              className="select select-inline"
              value={opts.mode}
              onChange={(e) => {
                const mode = e.target.value as CounterMode;
                set(
                  mode === "letter"
                    ? { mode, start: "A", end: "F" }
                    : mode === "number"
                      ? { mode, start: "1", end: "10" }
                      : { mode },
                );
              }}
            >
              <option value="number">Numbers</option>
              <option value="letter">Letters</option>
              <option value="none">No counter</option>
            </select>

            {opts.mode !== "none" && (
              <>
                <span className="small muted">from</span>
                <input
                  className="input select-inline"
                  style={{ width: 70 }}
                  value={opts.start}
                  onChange={(e) => set({ start: e.target.value })}
                />
                <span className="small muted">to</span>
                <input
                  className="input select-inline"
                  style={{ width: 70 }}
                  value={opts.end}
                  onChange={(e) => set({ end: e.target.value })}
                />
                <span className="small muted">step</span>
                <input
                  type="number"
                  className="input select-inline"
                  style={{ width: 64 }}
                  min={1}
                  value={opts.step}
                  onChange={(e) => set({ step: Number(e.target.value) || 1 })}
                />
              </>
            )}

            {opts.mode === "number" && (
              <>
                <span className="small muted">pad to</span>
                <input
                  type="number"
                  className="input select-inline"
                  style={{ width: 64 }}
                  min={0}
                  max={6}
                  value={opts.pad}
                  onChange={(e) => set({ pad: Number(e.target.value) || 0 })}
                  title="Zero-pad: 2 turns 1 into 01"
                />
              </>
            )}
          </div>
        </div>

        <div className="field">
          <span className="field-label">Suffix — comma-separate for several</span>
          <input
            className="input"
            value={opts.suffixes}
            onChange={(e) => set({ suffixes: e.target.value })}
            placeholder="L,R"
          />
        </div>

        <div className="field">
          <span className="field-label">
            Preview — {names.length} name{names.length === 1 ? "" : "s"}
          </span>
          <div className="gen-preview">
            {names.length === 0 ? (
              <span className="muted small">
                Nothing to generate yet — set a prefix, counter, or suffix.
              </span>
            ) : (
              names.map((n, i) => (
                <span key={`${n}-${i}`} className="badge">
                  {n}
                </span>
              ))
            )}
          </div>
        </div>

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={names.length === 0}
            onClick={() => {
              onInsert(names);
              onClose();
            }}
          >
            Add {names.length} to the list
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>
          These go into the name list, where you can still edit or delete
          individual entries before creating.
        </p>
      </div>
    </div>
  );
}
