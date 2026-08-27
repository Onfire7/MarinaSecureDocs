import { useMemo, useState } from "react";
import { runSetupPlan } from "../../data/setup";
import { useLocations, useLocationTypes } from "../../data/locations";
import { useTemplates, useTemplateSections } from "../../data/checklists";
import { resolveStatusByName, useLocationStatuses } from "../../data/lookups";
import {
  DEFAULT_GENERATOR,
  generateNames,
  TOKEN_HINT,
  type CounterMode,
  type GeneratorOptions,
} from "../../lib/nameGenerator";
import { LocationPicker, type PickerLocation } from "../shared/LocationPicker";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";

// Admin — Marina Setup Wizard (see docs/pages/admin-setup-wizard.html).
//
// Builds two levels of the hierarchy at once — containers (docks, areas)
// under a chosen anchor, and their children (slips, sites) — plus the
// checkpoints, tour, and template attachment that a new area needs to
// actually be patrolled. That whole job otherwise spans four screens.
//
// The design problem it exists to solve is that containers are NOT uniform:
// docks hold different numbers of slips and name them differently. So the
// shared pattern is a *template* referencing the container ({parent.last} →
// "A" for Dock A), and every row keeps its own editable copy of it. One
// pattern therefore covers rows with different prefixes, and the only thing
// left differing is the count — one number per row.
//
// Re-runnable by design: existing containers under the anchor are listed
// alongside new ones, and any generated name that already exists under its
// container is skipped rather than duplicated. Adding a dock next season is
// the same flow as the initial build-out. The wizard only ever creates.
export function AdminSetupWizardPage() {
  return (
    <AdminGate requires="manage_locations">
      <SetupWizard />
    </AdminGate>
  );
}

interface RowConfig {
  key: string;
  name: string;
  /** Set when this container already exists; absent means create it. */
  existingId?: string;
  include: boolean;
  expanded: boolean;
  pattern: GeneratorOptions;
  checkpoint: boolean;
}

type Step = 1 | 2 | 3;

/**
 * Pluralizes an admin-defined type name. These are arbitrary strings
 * ("Slip", "Place", "Boathouse"), so the naive `+ "ren"` for children read
 * as "3 Placeren" — the label has to follow the noun, not the concept.
 */
function plural(count: number, noun: string): string {
  if (count === 1) return `1 ${noun}`;
  const suffix = /(?:s|x|z|ch|sh)$/i.test(noun) ? "es" : "s";
  return `${count} ${noun}${suffix}`;
}

function SetupWizard() {
  const [step, setStep] = useState<Step>(1);

  // ---- step 1: scope
  const [anchorId, setAnchorId] = useState("");
  const [containerTypeId, setContainerTypeId] = useState("");
  const [childTypeId, setChildTypeId] = useState("");

  // ---- step 2: rows
  const [shared, setShared] = useState<GeneratorOptions>({
    ...DEFAULT_GENERATOR,
    prefixes: "{parent.last}",
  });
  const [rows, setRows] = useState<RowConfig[]>([]);
  const [newContainers, setNewContainers] = useState("");
  const [childCheckpoints, setChildCheckpoints] = useState(false);

  // ---- step 3: extras
  const [tourName, setTourName] = useState("");
  const [tourMode, setTourMode] = useState("freeform");
  const [templateId, setTemplateId] = useState("");
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const { data: locations } = useLocations();
  const { data: types } = useLocationTypes();
  const { data: allTemplates } = useTemplates();
  const { data: allSections } = useTemplateSections();
  const { statuses: locationStatuses } = useLocationStatuses();
  const templates = allTemplates.filter((t) => t.trigger_type === "checkpoint");

  const childrenOf = useMemo(() => {
    const m = new Map<string, typeof locations>();
    for (const l of locations) {
      const key = l.parent_id ?? "";
      const list = m.get(key) ?? [];
      list.push(l);
      m.set(key, list);
    }
    return m;
  }, [locations]);

  // Containers already under the anchor — the re-run case. Offered unchecked
  // so a second run doesn't silently re-process last season's docks.
  const existingContainers = useMemo(() => {
    if (!anchorId) return [];
    return (childrenOf.get(anchorId) ?? []).filter((l) =>
      containerTypeId ? l.location_type_id === containerTypeId : true,
    );
  }, [anchorId, containerTypeId, childrenOf]);

  const enterStep2 = () => {
    setRows(
      existingContainers.map((l) => ({
        key: l.id,
        name: l.name,
        existingId: l.id,
        include: false,
        expanded: false,
        pattern: { ...shared },
        checkpoint: false,
      })),
    );
    setStep(2);
  };

  const addContainers = () => {
    const names = newContainers
      .split("\n")
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    setRows((prev) => [
      ...prev,
      ...names.map((name) => ({
        key: `new-${name}-${Math.random().toString(36).slice(2, 8)}`,
        name,
        include: true,
        expanded: false,
        pattern: { ...shared },
        checkpoint: true,
      })),
    ]);
    setNewContainers("");
  };

  const patchRow = (key: string, patch: Partial<RowConfig>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const applySharedToAll = () =>
    setRows((prev) =>
      prev.map((r) => (r.include ? { ...r, pattern: { ...shared } } : r)),
    );

  // Existing child names per container, so a re-run skips what's there.
  const existingChildNames = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const [parentId, kids] of childrenOf) {
      m.set(parentId, new Set(kids.map((k) => k.name.toLowerCase())));
    }
    return m;
  }, [childrenOf]);

  const plan = useMemo(() => {
    return rows
      .filter((r) => r.include)
      .map((r) => {
        const generated = generateNames(r.pattern, r.name);
        const taken = r.existingId
          ? (existingChildNames.get(r.existingId) ?? new Set<string>())
          : new Set<string>();
        const seen = new Set<string>();
        const fresh: string[] = [];
        let skipped = 0;
        for (const n of generated) {
          const key = n.toLowerCase();
          if (taken.has(key) || seen.has(key)) {
            skipped++;
            continue;
          }
          seen.add(key);
          fresh.push(n);
        }
        return { row: r, generated, fresh, skipped };
      });
  }, [rows, existingChildNames]);

  const totals = useMemo(() => {
    const newContainerCount = plan.filter((p) => !p.row.existingId).length;
    const childCount = plan.reduce((s, p) => s + p.fresh.length, 0);
    const containerCheckpoints = plan.filter((p) => p.row.checkpoint).length;
    const checkpointCount =
      containerCheckpoints + (childCheckpoints ? childCount : 0);
    const skipped = plan.reduce((s, p) => s + p.skipped, 0);
    return {
      newContainerCount,
      childCount,
      checkpointCount,
      containerCheckpoints,
      skipped,
    };
  }, [plan, childCheckpoints]);

  const anchorName = locations.find((l) => l.id === anchorId)?.name ?? "";
  const containerTypeName = types.find((t) => t.id === containerTypeId)?.name ?? "";
  const childTypeName = types.find((t) => t.id === childTypeId)?.name ?? "";

  const commit = async () => {
    setCommitting(true);
    setError(null);
    try {
      // A new location starts in whichever status the marina calls vacant, if
      // it has one and its type tracks status at all. No status is a valid
      // answer, and better than one that matches no row.
      const vacant = resolveStatusByName(locationStatuses, "Vacant");
      const tracks = (typeId: string) =>
        types.find((t) => t.id === typeId)?.tracks_status === 1;

      await runSetupPlan(
        {
          anchorId: anchorId || null,
          containerTypeId,
          childTypeId,
          containerStatusId: tracks(containerTypeId) ? (vacant?.id ?? null) : null,
          childStatusId: tracks(childTypeId) ? (vacant?.id ?? null) : null,
          childCheckpoints,
          containers: plan.map((p) => ({
            existingId: p.row.existingId,
            name: p.row.name,
            checkpoint: p.row.checkpoint,
            children: p.fresh,
          })),
          tour: tourName.trim() ? { name: tourName.trim(), mode: tourMode } : null,
          templateId: templateId || null,
          templateSectionStart: allSections.filter((x) => x.template_id === templateId)
            .length,
        },
        (written, total) => setProgress(`Writing ${written} of ${total}…`),
      );

      setDone(
        `Created ${plural(totals.newContainerCount, containerTypeName || "container")}, ` +
          `${plural(totals.childCount, childTypeName || "child")}, ` +
          `and ${plural(totals.checkpointCount, "checkpoint")}` +
          (totals.skipped > 0 ? ` · skipped ${totals.skipped} already present` : "") +
          ".",
      );
      setRows([]);
      setTourName("");
      setTemplateId("");
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : "Something failed while writing.") +
          " Anything written before the failure was kept — re-running skips it.",
      );
    } finally {
      setCommitting(false);
      setProgress("");
    }
  };

  return (
    <div>
      <AdminHeader title="Marina Setup Wizard" />

      <div className="chip-row">
        {([1, 2, 3] as Step[]).map((s) => (
          <button
            key={s}
            type="button"
            className={"chip" + (step === s ? " active" : "")}
            disabled={s > 1 && !anchorId}
            onClick={() => setStep(s)}
          >
            {s}. {s === 1 ? "Scope" : s === 2 ? "Containers & children" : "Finish"}
          </button>
        ))}
      </div>

      {done && (
        <div className="badge badge-good" style={{ display: "block", marginBottom: 12 }}>
          {done}
        </div>
      )}
      {error && (
        <div className="badge badge-bad" style={{ display: "block", marginBottom: 12 }}>
          {error}
        </div>
      )}

      {step === 1 && (
        <ScopeStep
          locations={locations}
          types={types}
          anchorId={anchorId}
          setAnchorId={setAnchorId}
          containerTypeId={containerTypeId}
          setContainerTypeId={setContainerTypeId}
          childTypeId={childTypeId}
          setChildTypeId={setChildTypeId}
          existingCount={existingContainers.length}
          onNext={enterStep2}
        />
      )}

      {step === 2 && (
        <div>
          <p className="muted small" style={{ marginBottom: 12 }}>
            Building {childTypeName || "children"} under{" "}
            {containerTypeName || "containers"} in{" "}
            <strong>{anchorName || "the marina"}</strong>.
          </p>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="section-title">Add containers</div>
            <textarea
              className="textarea"
              rows={3}
              value={newContainers}
              onChange={(e) => setNewContainers(e.target.value)}
              placeholder={"Dock A\nDock B\nDock C"}
            />
            <div className="row" style={{ marginTop: 6 }}>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!newContainers.trim()}
                onClick={addContainers}
              >
                Add to the table
              </button>
              <span className="muted small">
                One per line. Existing ones are already listed below.
              </span>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="section-title spread">
              <span>Shared naming pattern</span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={plan.length === 0}
                onClick={applySharedToAll}
              >
                Apply to all included rows
              </button>
            </div>
            <PatternFields opts={shared} onChange={setShared} />
            <p className="muted small" style={{ marginTop: 6 }}>
              {TOKEN_HINT}
            </p>
          </div>

          <div className="stack" style={{ gap: 6 }}>
            {rows.map((r) => {
              const p = plan.find((x) => x.row.key === r.key);
              return (
                <RowCard
                  key={r.key}
                  row={r}
                  preview={p?.fresh ?? []}
                  skipped={p?.skipped ?? 0}
                  onPatch={(patch) => patchRow(r.key, patch)}
                  onRemove={() =>
                    setRows((prev) => prev.filter((x) => x.key !== r.key))
                  }
                />
              );
            })}
            {rows.length === 0 && (
              <div className="placeholder">
                <div className="big">No containers yet</div>
                Add some above, or pick an anchor that already has children.
              </div>
            )}
          </div>

          <label className="row" style={{ cursor: "pointer", marginTop: 12 }}>
            <input
              type="checkbox"
              checked={childCheckpoints}
              onChange={(e) => setChildCheckpoints(e.target.checked)}
            />
            <span className="small">
              Also create a checkpoint at every child — rarely wanted; a
              checkpoint per slip means {totals.childCount} of them
            </span>
          </label>

          <div className="row" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-quiet" onClick={() => setStep(1)}>
              ← Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={plan.length === 0}
              onClick={() => setStep(3)}
            >
              Review →
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="section-title">Optional — tie it together</div>
            <div className="field">
              <span className="field-label">
                Build a tour from the {totals.checkpointCount} new checkpoint
                {totals.checkpointCount === 1 ? "" : "s"}
              </span>
              <div className="row" style={{ flexWrap: "wrap" }}>
                <input
                  className="input select-inline"
                  style={{ minWidth: 200 }}
                  placeholder="Tour name — leave blank for none"
                  value={tourName}
                  onChange={(e) => setTourName(e.target.value)}
                />
                <select
                  className="select select-inline"
                  value={tourMode}
                  onChange={(e) => setTourMode(e.target.value)}
                  disabled={!tourName.trim()}
                >
                  <option value="freeform">Freeform</option>
                  <option value="linear">Linear</option>
                  <option value="randomized">Randomized</option>
                </select>
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">
                Attach a checkpoint-triggered template to them
              </span>
              <select
                className="select select-inline"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">None</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {templates.length === 0 && (
                <p className="muted small" style={{ marginTop: 4 }}>
                  No checkpoint-triggered templates exist yet.
                </p>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="section-title">This will create</div>
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                {plural(totals.newContainerCount, containerTypeName || "container")}{" "}
                under {anchorName}
                {plan.length - totals.newContainerCount > 0 &&
                  ` (plus ${plural(plan.length - totals.newContainerCount, "existing one")} being filled in)`}
              </li>
              <li>{plural(totals.childCount, childTypeName || "child")}</li>
              <li>
                {plural(totals.checkpointCount, "checkpoint")}
                {totals.containerCheckpoints > 0 &&
                  ` (${totals.containerCheckpoints} at the ${containerTypeName || "container"} level)`}
              </li>
              {tourName.trim() && <li>the tour "{tourName.trim()}" ({tourMode})</li>}
              {templateId && (
                <li>
                  attachment to "{templates.find((t) => t.id === templateId)?.name}"
                </li>
              )}
              {totals.skipped > 0 && (
                <li className="muted">
                  {totals.skipped} generated name
                  {totals.skipped === 1 ? "" : "s"} already exist and will be
                  skipped
                </li>
              )}
            </ul>
          </div>

          <div className="row">
            <button type="button" className="btn btn-quiet" onClick={() => setStep(2)}>
              ← Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={committing || plan.length === 0}
              onClick={() => void commit()}
            >
              {committing ? progress || "Creating…" : "Create everything"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScopeStep({
  locations,
  types,
  anchorId,
  setAnchorId,
  containerTypeId,
  setContainerTypeId,
  childTypeId,
  setChildTypeId,
  existingCount,
  onNext,
}: {
  locations: PickerLocation[];
  types: { id: string; name: string }[];
  anchorId: string;
  setAnchorId: (v: string) => void;
  containerTypeId: string;
  setContainerTypeId: (v: string) => void;
  childTypeId: string;
  setChildTypeId: (v: string) => void;
  existingCount: number;
  onNext: () => void;
}) {
  return (
    <div className="card">
      <div className="field">
        <span className="field-label">
          Anchor — the location the containers sit under
        </span>
        {/* Not assumed to be a root: a marina adds a whole new boathouse row
            under an existing area far more often than it adds a property. */}
        <LocationPicker
          locations={locations}
          value={anchorId}
          onChange={setAnchorId}
          placeholder="Search locations…"
          allowNone={false}
        />
        {anchorId && (
          <p className="muted small" style={{ marginTop: 4 }}>
            {existingCount} matching container
            {existingCount === 1 ? "" : "s"} already there — they'll be listed
            so you can fill them in too.
          </p>
        )}
      </div>

      <div className="grid-2">
        <div className="field">
          <span className="field-label">Container type — e.g. Dock</span>
          <select
            className="select"
            aria-label="Container type"
            value={containerTypeId}
            onChange={(e) => setContainerTypeId(e.target.value)}
          >
            <option value="">Select…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Child type — e.g. Slip</span>
          <select
            className="select"
            aria-label="Child type"
            value={childTypeId}
            onChange={(e) => setChildTypeId(e.target.value)}
          >
            <option value="">Select…</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary"
        disabled={!anchorId || !containerTypeId || !childTypeId}
        onClick={onNext}
      >
        Next →
      </button>
    </div>
  );
}

function PatternFields({
  opts,
  onChange,
}: {
  opts: GeneratorOptions;
  onChange: (next: GeneratorOptions) => void;
}) {
  const set = (patch: Partial<GeneratorOptions>) => onChange({ ...opts, ...patch });
  return (
    <div className="row" style={{ flexWrap: "wrap" }}>
      <input
        className="input select-inline"
        style={{ width: 150 }}
        value={opts.prefixes}
        onChange={(e) => set({ prefixes: e.target.value })}
        placeholder="prefix"
        aria-label="Prefix"
      />
      <select
        className="select select-inline"
        value={opts.mode}
        aria-label="Counter mode"
        onChange={(e) => {
          const mode = e.target.value as CounterMode;
          onChange({
            ...opts,
            mode,
            ...(mode === "letter"
              ? { start: "A", end: "F" }
              : mode === "number"
                ? { start: "1", end: "10" }
                : {}),
          });
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
            style={{ width: 60 }}
            value={opts.start}
            onChange={(e) => set({ start: e.target.value })}
            aria-label="Counter start"
          />
          <span className="small muted">to</span>
          <input
            className="input select-inline"
            style={{ width: 60 }}
            value={opts.end}
            onChange={(e) => set({ end: e.target.value })}
            aria-label="Counter end"
          />
        </>
      )}
      {/* Zero-padding genuinely varies between neighbouring containers —
          BH30-01L next door to BH32-1L — so it has to be per-row settable,
          not a wizard-wide constant. */}
      {opts.mode === "number" && (
        <>
          <span className="small muted">pad</span>
          <input
            type="number"
            className="input select-inline"
            style={{ width: 56 }}
            min={0}
            max={6}
            value={opts.pad}
            onChange={(e) => set({ pad: Number(e.target.value) || 0 })}
            aria-label="Zero pad"
            title="2 turns 1 into 01"
          />
        </>
      )}
      <input
        className="input select-inline"
        style={{ width: 110 }}
        value={opts.suffixes}
        onChange={(e) => set({ suffixes: e.target.value })}
        placeholder="suffix, e.g. L,R"
        aria-label="Suffix"
      />
    </div>
  );
}

function RowCard({
  row,
  preview,
  skipped,
  onPatch,
  onRemove,
}: {
  row: RowConfig;
  preview: string[];
  skipped: number;
  onPatch: (patch: Partial<RowConfig>) => void;
  onRemove: () => void;
}) {
  const summary =
    preview.length === 0
      ? "nothing new"
      : preview.length <= 3
        ? preview.join(", ")
        : `${preview[0]} … ${preview[preview.length - 1]}`;

  return (
    <div className="card">
      <div className="spread" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className="row" style={{ minWidth: 0, flex: "1 1 240px" }}>
          <input
            type="checkbox"
            checked={row.include}
            onChange={(e) => onPatch({ include: e.target.checked })}
            aria-label={`Include ${row.name}`}
          />
          <span style={{ minWidth: 0 }}>
            <span className="card-title">{row.name}</span>
            {row.existingId && <span className="badge" style={{ marginLeft: 6 }}>existing</span>}
            <span className="card-meta" style={{ display: "block" }}>
              {row.include ? (
                <>
                  {preview.length} new · {summary}
                  {skipped > 0 && (
                    <span className="muted"> · {skipped} already there</span>
                  )}
                </>
              ) : (
                <span className="muted">not included</span>
              )}
            </span>
          </span>
        </span>

        <div className="row">
          {/* The count is the override that actually varies dock to dock, so
              it sits on the row rather than behind the expander. */}
          {row.include && row.pattern.mode !== "none" && (
            <>
              <span className="small muted">up to</span>
              <input
                className="input select-inline"
                style={{ width: 64 }}
                value={row.pattern.end}
                aria-label={`Count for ${row.name}`}
                onChange={(e) =>
                  onPatch({ pattern: { ...row.pattern, end: e.target.value } })
                }
              />
            </>
          )}
          <label className="row" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={row.checkpoint}
              disabled={!row.include}
              onChange={(e) => onPatch({ checkpoint: e.target.checked })}
            />
            <span className="small">Checkpoint</span>
          </label>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => onPatch({ expanded: !row.expanded })}
          >
            {row.expanded ? "Done" : "Pattern"}
          </button>
          {!row.existingId && (
            <button type="button" className="btn btn-sm btn-quiet" onClick={onRemove}>
              ✕
            </button>
          )}
        </div>
      </div>

      {row.expanded && (
        <div style={{ marginTop: 10 }}>
          <PatternFields
            opts={row.pattern}
            onChange={(pattern) => onPatch({ pattern })}
          />
          <div className="gen-preview" style={{ marginTop: 8 }}>
            {preview.length === 0 ? (
              <span className="muted small">
                Nothing new — every generated name already exists here.
              </span>
            ) : (
              preview.slice(0, 200).map((n, i) => (
                <span key={`${n}-${i}`} className="badge">
                  {n}
                </span>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
