import type { AuditCategoryFlags } from "../../data/audits";

// Which built-in Status-kind sections an Audit Template or a launch asks
// about (docs/audits.md § Audit Templates). Occupancy's built-ins are not
// split into categories, so this renders only for kind "status".
const CATEGORIES: { key: keyof AuditCategoryFlags; label: string }[] = [
  { key: "include_attributes", label: "Attributes" },
  { key: "include_services", label: "Services" },
  { key: "include_amenities", label: "Amenities" },
  { key: "include_marked", label: "Clearly marked?" },
  { key: "include_map", label: "Placed on the map?" },
];

export function CategoryCheckboxes({
  flags,
  onChange,
}: {
  flags: AuditCategoryFlags;
  /**
   * Only the one key that changed — never a full row rebuilt from `flags`.
   * A caller that saves straight to the database on every click (the
   * template editor) would otherwise race two quick clicks: the second
   * click's spread of `flags` can still be the value from before the
   * first click's write round-tripped back through the live query, so it
   * silently reverts the first change. Emitting a delta and letting the
   * database (or the caller's own local state) merge it removes the race.
   */
  onChange: (patch: Partial<AuditCategoryFlags>) => void;
}) {
  return (
    <div className="chip-row" style={{ marginBottom: 0 }}>
      {CATEGORIES.map((c) => (
        <label key={c.key} className="chip" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={flags[c.key] === 1}
            onChange={(e) => onChange({ [c.key]: e.target.checked ? 1 : 0 })}
            style={{ marginRight: 6 }}
          />
          {c.label}
        </label>
      ))}
    </div>
  );
}
