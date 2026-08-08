import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Short terms (1–2 chars) must match the start of a whole word; longer ones
 * may match anywhere. Without that split, searching "dock c 14" also matches
 * Dock *A*'s Slip 14, because "c" is a substring of "do**c**k" — and short
 * terms are exactly the disambiguating ones in marina naming ("Dock C").
 */
function matchesTerms(path: string[], terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = path.join(" ").toLowerCase();
  const words = hay.split(/[\s→/-]+/).filter(Boolean);
  return terms.every((t) =>
    t.length <= 2 ? words.some((w) => w.startsWith(t)) : hay.includes(t),
  );
}

export interface PickerLocation {
  id: string;
  name: string;
  parent?: { id: string } | null;
  type?: { name: string } | null;
}

/**
 * Searchable location combobox built for marinas with thousands of
 * locations: names repeat constantly across docks ("Slip 14" exists on every
 * one), so every result carries its full ancestor path — that's what
 * actually disambiguates. Matching runs against the path too, so typing
 * "dock c 14" finds Slip 14 under Dock C.
 */
export function LocationPicker({
  locations,
  value,
  onChange,
  placeholder = "Search locations…",
  allowNone = true,
  noneLabel = "None",
  excludeId,
  maxResults = 60,
  autoFocus = false,
}: {
  locations: PickerLocation[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  /** Take the cursor on mount — for dialogs that open onto this field. */
  autoFocus?: boolean;
  /** Omit this location and its descendants — a location can't parent itself. */
  excludeId?: string;
  maxResults?: number;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Taking the cursor shouldn't also drop the whole list over whatever sits
  // below the field — in a dialog that's the rest of the form. The first
  // focus is the one this component gave itself; typing opens the menu, as
  // does focusing it by hand afterwards.
  const suppressOpenOnFocus = useRef(autoFocus);

  const byId = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations],
  );

  // Ancestor path + depth for every location, computed once per data change.
  const meta = useMemo(() => {
    const out = new Map<string, { path: string[]; depth: number }>();
    const resolve = (l: PickerLocation): { path: string[]; depth: number } => {
      const cached = out.get(l.id);
      if (cached) return cached;
      const parent = l.parent?.id ? byId.get(l.parent.id) : undefined;
      const parentMeta = parent
        ? resolve(parent)
        : { path: [] as string[], depth: -1 };
      const entry = {
        path: [...parentMeta.path, l.name],
        depth: parentMeta.depth + 1,
      };
      out.set(l.id, entry);
      return entry;
    };
    for (const l of locations) resolve(l);
    return out;
  }, [locations, byId]);

  // Excluding a subtree keeps a location from being reparented under itself.
  const excluded = useMemo(() => {
    if (!excludeId) return new Set<string>();
    const out = new Set<string>([excludeId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of locations) {
        if (!out.has(l.id) && l.parent?.id && out.has(l.parent.id)) {
          out.add(l.id);
          grew = true;
        }
      }
    }
    return out;
  }, [excludeId, locations]);

  const results = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return locations
      .filter((l) => !excluded.has(l.id))
      .filter((l) => matchesTerms(meta.get(l.id)?.path ?? [l.name], terms))
      .sort((a, b) => {
        const pa = meta.get(a.id)?.path.join(" / ") ?? a.name;
        const pb = meta.get(b.id)?.path.join(" / ") ?? b.name;
        return pa.localeCompare(pb, undefined, { numeric: true });
      })
      .slice(0, maxResults);
  }, [locations, query, meta, excluded, maxResults]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = value ? byId.get(value) : undefined;
  const selectedPath = selected
    ? (meta.get(selected.id)?.path ?? [selected.name]).join(" → ")
    : "";

  const pick = (locationId: string) => {
    onChange(locationId);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="picker" ref={boxRef}>
      <div className="picker-field">
        <input
          className="input"
          autoFocus={autoFocus}
          value={open ? query : selectedPath}
          placeholder={selected ? selectedPath : placeholder}
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
        {/* Inside the field against its right edge, where a combobox's own
            clear lives — outside it read as a separate control and cost the
            field width it needed for the path.
            Nothing to clear to when a location is required, so the button
            only exists where empty is a legal value. */}
        {selected && allowNone && (
          <button
            type="button"
            className="btn btn-sm btn-quiet picker-clear"
            onClick={() => onChange("")}
            title="Clear"
            aria-label="Clear location"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div className="picker-menu">
          {allowNone && (
            <button
              type="button"
              className="picker-option"
              onClick={() => pick("")}
            >
              {noneLabel}
            </button>
          )}
          {results.map((l) => {
            const m = meta.get(l.id);
            const path = m?.path ?? [l.name];
            return (
              <button
                key={l.id}
                type="button"
                className={"picker-option" + (l.id === value ? " active" : "")}
                style={{ paddingLeft: 10 + (m?.depth ?? 0) * 14 }}
                onClick={() => pick(l.id)}
              >
                <span>{l.name}</span>
                {path.length > 1 && (
                  <span className="muted small">
                    {" "}
                    · {path.slice(0, -1).join(" → ")}
                  </span>
                )}
                {l.type?.name && (
                  <span className="badge" style={{ marginLeft: 6 }}>
                    {l.type.name}
                  </span>
                )}
              </button>
            );
          })}
          {results.length === 0 && (
            <div className="picker-option muted">No matches</div>
          )}
          {results.length === maxResults && (
            <div className="picker-option muted small">
              Showing the first {maxResults} — keep typing to narrow.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
