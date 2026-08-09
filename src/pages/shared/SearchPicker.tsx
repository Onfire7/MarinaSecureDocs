import { useEffect, useMemo, useRef, useState } from "react";
import { matchesTerms, queryTerms } from "../../lib/search";

export interface SearchPickerOption {
  id: string;
  name: string;
  /** Second line — whatever tells two same-named rows apart. */
  hint?: string;
}

/**
 * Single-select combobox with a filter box, for lists too long to scan.
 *
 * A native `<select>` is fine for five options and hopeless for two hundred:
 * a marina's checkpoints run into the hundreds and repeat their names across
 * docks, so finding one means typing part of it. Shaped after LocationPicker
 * so the two read as the same control, but ordering belongs to the caller —
 * this list is often sorted by distance, which alphabetising would destroy.
 */
export function SearchPicker({
  options,
  value,
  onChange,
  placeholder = "Search…",
  emptyMessage = "No matches",
  autoFocus = false,
}: {
  options: SearchPickerOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Taking the cursor mustn't also drop the list over the form, and mustn't
  // swap a preselected row's name for an empty filter box. The first focus
  // is the one this component gave itself; typing opens the menu, as does
  // focusing it by hand afterwards.
  const suppressOpenOnFocus = useRef(autoFocus);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const results = useMemo(() => {
    const terms = queryTerms(query);
    return options.filter((o) => matchesTerms([o.name, o.hint ?? ""], terms));
  }, [options, query]);

  const selected = options.find((o) => o.id === value);
  const selectedText = selected
    ? selected.name + (selected.hint ? ` — ${selected.hint}` : "")
    : "";

  const pick = (id: string) => {
    onChange(id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="picker" ref={boxRef}>
      <div className="picker-field">
        <input
          className="input"
          autoFocus={autoFocus}
          value={open ? query : selectedText}
          placeholder={selected ? selectedText : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (suppressOpenOnFocus.current) {
              suppressOpenOnFocus.current = false;
              return;
            }
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && open && results.length > 0) {
              e.preventDefault();
              pick(results[0].id);
            }
          }}
        />
      </div>

      {open && (
        <div className="picker-menu">
          {results.map((o) => (
            <button
              key={o.id}
              type="button"
              className={"picker-option" + (o.id === value ? " active" : "")}
              onClick={() => pick(o.id)}
            >
              {o.name}
              {o.hint && (
                <span className="muted small" style={{ display: "block" }}>
                  {o.hint}
                </span>
              )}
            </button>
          ))}
          {results.length === 0 && (
            <div className="picker-option muted small">
              {options.length === 0 ? emptyMessage : "No matches"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
