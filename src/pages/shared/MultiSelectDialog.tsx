import { useMemo, useState } from "react";
import { matchesTerms, queryTerms } from "../../lib/search";

export interface MultiSelectOption {
  id: string;
  name: string;
  /** Secondary label — the location a checkpoint sits at, for instance. */
  group?: string;
}

const UNGROUPED = "—";

/**
 * Picks many things at once and commits them in a single transaction.
 *
 * Every "add a checkpoint…" affordance in Admin used to be a single-select
 * `<select>` that wrote on each change: assembling a 15-checkpoint tour meant
 * 15 dropdown round-trips and 15 transactions. Selection is local state here
 * and `onConfirm` fires once, so the same job is one pass and one write.
 *
 * Results group by `group` with a per-group "Select all" — the grouping is
 * what makes "everything on Dock C" a single click rather than a hunt.
 */
export function MultiSelectDialog({
  title,
  options,
  onConfirm,
  onClose,
  confirmLabel = "Add",
  emptyMessage = "Nothing left to add.",
}: {
  title: string;
  /** Already-selected entries should be filtered out by the caller. */
  options: MultiSelectOption[];
  onConfirm: (ids: string[]) => void;
  onClose: () => void;
  confirmLabel?: string;
  emptyMessage?: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    const terms = queryTerms(query);
    return options.filter((o) => matchesTerms([o.name, o.group ?? ""], terms));
  }, [options, query]);

  // Grouped for display, but ordered numerically so "Slip 2" precedes
  // "Slip 10" — marina naming is full of numbers that sort wrong as strings.
  const groups = useMemo(() => {
    const m = new Map<string, MultiSelectOption[]>();
    for (const o of visible) {
      const key = o.group || UNGROUPED;
      const list = m.get(key) ?? [];
      list.push(o);
      m.set(key, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    }
    return [...m.entries()].sort((a, b) =>
      a[0].localeCompare(b[0], undefined, { numeric: true }),
    );
  }, [visible]);

  const toggle = (optionId: string) => {
    const next = new Set(selected);
    if (next.has(optionId)) next.delete(optionId);
    else next.add(optionId);
    setSelected(next);
  };

  const setMany = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    for (const optionId of ids) {
      if (on) next.add(optionId);
      else next.delete(optionId);
    }
    setSelected(next);
  };

  const visibleIds = visible.map((o) => o.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((optionId) => selected.has(optionId));

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-card"
        style={{ maxWidth: 620 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-title" style={{ marginBottom: 10 }}>
          {title}
        </div>

        <div className="row" style={{ marginBottom: 8, flexWrap: "wrap" }}>
          <input
            className="input select-inline"
            style={{ flex: "1 1 220px" }}
            placeholder="Filter…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {visibleIds.length > 0 && (
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setMany(visibleIds, !allVisibleSelected)}
            >
              {allVisibleSelected ? "Clear" : `Select all ${visibleIds.length}`}
              {query.trim() && !allVisibleSelected ? " matching" : ""}
            </button>
          )}
        </div>

        <div className="multiselect-scroll">
          {groups.map(([groupName, items]) => {
            const ids = items.map((o) => o.id);
            const allOn = ids.every((optionId) => selected.has(optionId));
            return (
              <div key={groupName}>
                <div className="multiselect-group">
                  <span className="small muted">{groupName}</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet"
                    onClick={() => setMany(ids, !allOn)}
                  >
                    {allOn ? "None" : "All"}
                  </button>
                </div>
                {items.map((o) => (
                  <label key={o.id} className="multiselect-option">
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() => toggle(o.id)}
                    />
                    <span className="small">{o.name}</span>
                  </label>
                ))}
              </div>
            );
          })}
          {visible.length === 0 && (
            <div className="picker-option muted small">
              {options.length === 0 ? emptyMessage : "No matches"}
            </div>
          )}
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={selected.size === 0}
            onClick={() => {
              onConfirm([...selected]);
              onClose();
            }}
          >
            {confirmLabel} {selected.size || ""}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
