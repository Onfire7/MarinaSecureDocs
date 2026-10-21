import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { dataT } from "../../i18n";
import {
  FLEET_ITEM_MODES,
  fleetDefaultLabelKey,
  fleetItemMode,
  type FleetItemMode,
  type FleetVehicleConfig,
} from "../../lib/fleetItem";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import {
  copySectionToLocations,
  createItem,
  createSection,
  createTemplate,
  deleteItem,
  deleteSection,
  deleteTemplate,
  duplicateTemplate,
  dueByRule,
  itemConfig,
  itemHasInstances,
  orphanItem,
  reorderItems,
  reorderSections,
  reviseItem,
  saveSection,
  saveTemplate,
  setSectionAssets,
  setSectionCheckpoints,
  setTemplateViewerRoles,
  templateTriggerConfig,
  useSectionAssets,
  useSectionCheckpoints,
  useTemplateItems,
  useTemplates,
  useTemplateSections,
  useTemplateViewerRoles,
} from "../../data/checklists";
import { updateOpenChecklists, useOpenChecklistPlans } from "../../data/checklistUpdate";
import { useRoles } from "../../data/users";
import { useLocations } from "../../data/locations";
import { useCheckpoints } from "../../data/checkpoints";
import { useAssets } from "../../data/assets";
import { useLocationStatuses } from "../../data/lookups";
import {
  hideUntilWarning,
  ITEM_TYPE_LABEL,
  QUESTION_ANSWER_LABEL,
  STATE_CHECK_KINDS,
  YES_NO_DETAILS_LABEL,
  isStateCheck,
  itemTypeLabel,
  normalizeItemType,
  type DueByRule,
  type ItemConfig,
  type ItemType,
  type QuestionAnswerType,
  type StateCheckType,
  type AssetEvent,
  type TriggerConfig,
  type YesNoDetailsOn,
} from "../../lib/checklists";
import { LocationPicker } from "../shared/LocationPicker";
import { locationPathResolver } from "../../lib/checkpoints";
import {
  coveredLocationIds,
  planSectionCopies,
  type CheckpointMode,
  type CopySourceSection,
} from "../../lib/sectionCopy";
import { compareNames } from "../../lib/locations";
import { MultiSelectDialog } from "../shared/MultiSelectDialog";
import { ReorderableList } from "../shared/ReorderableList";
import {
  clockOutBlockedReason,
  endShiftBlockedReason,
  endShiftHidden,
  pinEndShiftLast,
  type TemplateShape,
} from "../../lib/endOfShift";
import { AdminHeader } from "./AdminHomePage";
import { DraftInput, DraftNumberInput } from "../shared/DraftInput";

// Admin — Checklist Templates (see AdminChecklistTemplatesPage.spec.md).
// Authoring for the sectioned checklist model: a template belongs to one
// role, contains ordered sections (each with its own trigger, visibility
// rule, and place attachment), and sections contain the items. Template
// items are copy-on-edit: committing a change writes a new row (version+1,
// previousVersion link) and repoints the section, so instances created
// before the edit keep rendering exactly what they were created from.
// Personal templates were removed with the visibility field — they return
// later as their own feature.
export function AdminChecklistTemplatesPage() {
  const current = useCurrent();
  const canManage = current.can("manage_checklists");
  const [editing, setEditing] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  // A rejected write rolls its optimistic change back, so without this the
  // only evidence is a row quietly reverting under the editor's hands.
  useEffect(() => {
    reportWriteError = setWriteError;
    return () => {
      reportWriteError = null;
    };
  }, []);

  // Six flat lists, assembled once into the nested shape the editor reads.
  // The editor is a tree — a template holds sections, a section holds items and
  // its checkpoint and asset attachments — and building that here means the
  // 1,500 lines below never have to know it came from six tables.
  const { data: templateRows } = useTemplates();
  const { data: sectionRows } = useTemplateSections();
  const { data: itemRows } = useTemplateItems();
  const { data: sectionCheckpoints } = useSectionCheckpoints();
  const { data: sectionAssets } = useSectionAssets();
  const { data: viewerRoles } = useTemplateViewerRoles();
  const { roles } = useRoles();
  const { data: allLocations } = useLocations();
  const { data: checkpointRows } = useCheckpoints();
  const { data: assetRows } = useAssets();

  const locations = useMemo(
    () => [...allLocations].sort((a, b) => compareNames(a.name, b.name)),
    [allLocations],
  );
  const allCheckpoints = useMemo(
    () => [...checkpointRows].sort((a, b) => compareNames(a.name, b.name)),
    [checkpointRows],
  );
  const allAssets = useMemo(
    () => [...assetRows].sort((a, b) => compareNames(a.name, b.name)),
    [assetRows],
  );

  const templates = useMemo<TemplateRow[]>(() => {
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const locationById = new Map(allLocations.map((l) => [l.id, l]));
    const checkpointById = new Map(checkpointRows.map((c) => [c.id, c]));
    const assetById = new Map(assetRows.map((a) => [a.id, a]));
    return templateRows.map((t) => ({
      id: t.id,
      name: t.name,
      triggerType: t.trigger_type,
      triggerConfig: templateTriggerConfig(t),
      assignedToUser: t.assigned_to_user === 1,
      hideUntilRule: t.hide_until_rule ?? undefined,
      expectedStart: t.expected_start ?? undefined,
      dueBy: dueByRule(t) ?? undefined,
      assignedRole: t.assigned_role_id
        ? (roleById.get(t.assigned_role_id) ?? null)
        : null,
      viewerRoles: viewerRoles
        .filter((v) => v.template_id === t.id)
        .map((v) => roleById.get(v.role_id))
        .filter((r): r is NonNullable<typeof r> => Boolean(r)),
      creator: t.creator_name ? { id: t.creator_id!, name: t.creator_name } : null,
      sections: sectionRows
        .filter((sec) => sec.template_id === t.id)
        .map((sec) => ({
          id: sec.id,
          name: sec.name,
          order: sec.position,
          isActive: sec.is_active === 1,
          triggerConfig: templateTriggerConfig(sec),
          triggerType: sec.trigger_type,
          hideUntilRule: sec.hide_until_rule ?? undefined,
          dueBy: dueByRule(sec) ?? undefined,
          location: sec.location_id
            ? (locationById.get(sec.location_id) ?? null)
            : null,
          checkpoints: sectionCheckpoints
            .filter((sc) => sc.section_id === sec.id)
            .map((sc) => checkpointById.get(sc.checkpoint_id))
            .filter((c): c is NonNullable<typeof c> => Boolean(c)),
          assets: sectionAssets
            .filter((sa) => sa.section_id === sec.id)
            .map((sa) => assetById.get(sa.asset_id))
            .filter((a): a is NonNullable<typeof a> => Boolean(a)),
          items: itemRows
            .filter((it) => it.section_id === sec.id)
            .map((it) => ({
              id: it.id,
              type: it.type,
              label: it.label,
              order: it.position,
              version: it.version,
              previousVersionId: it.previous_version_id,
              config: itemConfig(it) as Record<string, unknown>,
            })),
        })),
    }));
  }, [
    templateRows,
    sectionRows,
    itemRows,
    sectionCheckpoints,
    sectionAssets,
    viewerRoles,
    roles,
    allLocations,
    checkpointRows,
    assetRows,
  ]);

  // Created with a placeholder name and opened straight into the editor,
  // where the name field already lives — a prompt first would just be a
  // modal asking for something the next screen also asks for. The required
  // role is asked for in the editor too, with a warning until it's set.
  const create = async () => {
    const templateId = await createTemplate({
      name: "New template",
      triggerType: "manual",
      assignedToUser: true,
      creatorId: current.user?.id ?? null,
    });
    setEditing(templateId);
  };

  if (!canManage) {
    return (
      <div>
        <AdminHeader title="Checklist Templates" />
        <p className="muted small">
          Managing checklist templates needs <code>manage_checklists</code>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader title="Checklist Templates">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => void create()}
        >
          + New template
        </button>
      </AdminHeader>

      {writeError && (
        <div
          className="badge badge-bad"
          style={{ display: "block", marginBottom: 8, padding: "8px 10px" }}
          role="alert"
        >
          {writeError}{" "}
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => setWriteError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="stack" style={{ gap: 8 }}>
        {templates.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            roles={roles}
            locations={locations}
            allCheckpoints={allCheckpoints}
            allAssets={allAssets}
            expanded={editing === t.id}
            onToggle={() => setEditing(editing === t.id ? null : t.id)}
            onDuplicated={setEditing}
          />
        ))}
        {templates.length === 0 && (
          <div className="placeholder">
            <div className="big">No templates yet</div>
            Templates generate the real checklists users work through.
          </div>
        )}
      </div>
    </div>
  );
}

type TemplateItemRow = {
  id: string;
  type: string;
  label: string;
  order: number;
  version?: number;
  previousVersionId?: string | null;
  config?: Record<string, unknown>;
};

type SectionRow = {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
  triggerType: string;
  triggerConfig?: TriggerConfig;
  hideUntilRule?: string;
  dueBy?: DueByRule;
  location?: { id: string; name: string; status_name?: string | null } | null;
  checkpoints?: { id: string; name: string }[];
  assets?: { id: string; name: string }[];
  items?: TemplateItemRow[];
};

/**
 * The nested shape this editor reads, assembled from six flat tables at the
 * top of the page. Everything below treats a template as a tree, because that
 * is what it is to whoever is authoring one.
 */
type TemplateRow = {
  id: string;
  name: string;
  triggerType: string;
  triggerConfig?: TriggerConfig;
  assignedToUser?: boolean;
  hideUntilRule?: string;
  expectedStart?: string;
  dueBy?: DueByRule;
  assignedRole?: { id: string; name: string } | null;
  viewerRoles?: { id: string; name: string }[];
  creator?: { id: string; name: string } | null;
  sections?: SectionRow[];
};

// Entries added since the copy catalog arrived carry a key instead of a
// label; the rest convert with the admin area (docs/TODO.md § Localization).
type TriggerOption = { value: string; label: string } | { value: string; labelKey: AdminKey };
type AdminKey =
  | "checklistTemplates.trigger.asset"
  | "checklistTemplates.sectionTrigger.check_out"
  | "checklistTemplates.sectionTrigger.check_in";

const TRIGGERS: TriggerOption[] = [
  { value: "manual", label: "Manual" },
  { value: "clock_in", label: "Clock In" },
  { value: "clock_out", label: "Clock Out" },
  { value: "checkpoint", label: "Checkpoint visit" },
  { value: "asset", labelKey: "checklistTemplates.trigger.asset" },
  { value: "recurring", label: "Recurring" },
];

/**
 * An asset section's event is its trigger as far as the editor is concerned,
 * so the select offers each as its own choice: "asset:check_out" stores
 * trigger_type "asset" with trigger_config.event "check_out".
 */
const SECTION_TRIGGERS: TriggerOption[] = [
  { value: "manual", label: "Always (with the checklist)" },
  { value: "recurring", label: "Recurring days" },
  { value: "checkpoint", label: "Checkpoint scan" },
  { value: "location", label: "Location visit" },
  { value: "asset:check_out", labelKey: "checklistTemplates.sectionTrigger.check_out" },
  { value: "asset:check_in", labelKey: "checklistTemplates.sectionTrigger.check_in" },
  { value: "location_status", label: "Location status" },
];

function sectionTriggerValue(triggerType: string, cfg: { event?: AssetEvent }): string {
  return triggerType === "asset" ? `asset:${cfg.event ?? "check_out"}` : triggerType;
}

const ELLIPSIS = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

/**
 * Runs a write and says so when it fails.
 *
 * Every mutation here used to be a fire-and-forget transaction, which throws
 * the promise away. Local-first writes apply optimistically, so a rejected one
 * rolls back — the row you just edited silently reverts or vanishes, with
 * nothing in the UI and only an anonymous unhandled rejection in the console.
 * Copy-on-edit makes that worse: the failing write both creates the new row and
 * orphans the old, so a partial refusal reads as "my item disappeared".
 *
 * It matters MORE on this stack, not less: a local write succeeds first and is
 * refused later, on upload, by RLS or a constraint. See the connector's note on
 * unretryable writes.
 */
let reportWriteError: ((message: string) => void) | null = null;

/**
 * Template writes still in flight. Update open checklists waits for these
 * before it plans: clicking it blurs whatever label was being edited, and that
 * commit (check references, create, delete) would otherwise interleave with
 * the update and hand it a template half-way through an edit.
 */
const inFlight = new Set<Promise<unknown>>();

function track<T>(run: Promise<T>): Promise<T> {
  inFlight.add(run);
  void run.finally(() => inFlight.delete(run)).catch(() => {});
  return run;
}

/** Every template write started so far has landed locally. */
function templateWritesSettled(): Promise<unknown> {
  return Promise.allSettled([...inFlight]);
}

/** Resolves once the write has landed or been reported; never rejects. */
function write(what: string, run: Promise<unknown>): Promise<void> {
  track(run);
  return run.then(
    () => {},
    (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`checklist templates — ${what} failed:`, err);
      reportWriteError?.(`Couldn't ${what}: ${message}`);
    },
  );
}

/** A section's settings read back as one line — see templateSummary. */
function sectionSummary(
  section: SectionRow,
  triggerLabel: string,
) {
  const parts = [triggerLabel];
  if (section.location) parts.push(section.location.name);
  if (section.hideUntilRule) parts.push(`from ${section.hideUntilRule}`);
  if (section.dueBy?.kind === "time") parts.push(`due ${section.dueBy.time}`);
  if (section.dueBy?.kind === "offset")
    parts.push(`due within ${section.dueBy.minutes}m`);
  return parts.join(" · ");
}

/**
 * The settings block read back as one sentence. Five fields describing what
 * is usually a single fact ("Clock In, due within an hour") cost most of the
 * editor's height before you reached the sections, which are what you came
 * for — so they fold up into this and open on a tap.
 */
function templateSummary(template: TemplateRow, t: (key: AdminKey) => string) {
  const parts = [
    template.assignedRole?.name ?? "no role",
    triggerLabel(TRIGGERS, template.triggerType, t),
  ];
  if (template.hideUntilRule) parts.push(`from ${template.hideUntilRule}`);
  if (template.dueBy?.kind === "time") parts.push(`due ${template.dueBy.time}`);
  if (template.dueBy?.kind === "offset")
    parts.push(`due within ${template.dueBy.minutes}m`);
  if (template.assignedToUser) parts.push("self-assigned");
  return parts.join(" · ");
}

/**
 * A combobox that picks several things: a checkbox per row while open, and
 * the chosen ones as bubbles inside the closed field — the same bubbles they
 * wear everywhere else. Reads as one line at rest however many are picked,
 * where a checkbox list cost a row per option whether or not it was one of
 * the answers.
 *
 * Shaped after LocationPicker so the two read as the same control; the
 * difference is that this one keeps the menu open between ticks, because
 * picking several is the whole point.
 */
function ChipMultiSelect({
  options,
  selectedIds,
  onToggle,
  placeholder,
  emptyMessage,
  disabled = false,
}: {
  options: { id: string; name: string }[];
  selectedIds: Set<string>;
  onToggle: (optionId: string, on: boolean) => void;
  placeholder: string;
  emptyMessage: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = options.filter((o) => selectedIds.has(o.id));

  return (
    <div className="picker field-control" ref={boxRef}>
      <button
        type="button"
        className="input chip-select"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {selected.length > 0 ? (
          selected.map((o) => (
            <span key={o.id} className="badge">
              {o.name}
            </span>
          ))
        ) : (
          <span className="muted">{placeholder}</span>
        )}
      </button>
      {open && !disabled && (
        <div className="picker-menu">
          {options.map((o) => (
            <label key={o.id} className="picker-check">
              <input
                type="checkbox"
                checked={selectedIds.has(o.id)}
                onChange={(e) => onToggle(o.id, e.target.checked)}
              />
              <span>{o.name}</span>
            </label>
          ))}
          {options.length === 0 && (
            <div className="picker-option muted small">{emptyMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The name a new item arrives with. A door check in a section that is a
 * place is "Main Office Door" far more often than it is anything else, so
 * that is what it gets — pre-selected, to be typed over when it isn't.
 * Types with no noun of their own, and sections with no location, keep the
 * type's name: a guess nobody wants is worse than no guess.
 */
function defaultItemLabel(type: ItemType, placeName?: string) {
  // Written into the template: the marina's language, not the editor's.
  if (type === "fleet_vehicle")
    return dataT(fleetDefaultLabelKey("take") as "fleet.defaultLabel.take", { ns: "checklists" });
  if (!placeName || !isStateCheck(type)) return ITEM_TYPE_LABEL[type];
  const { noun } = STATE_CHECK_KINDS[normalizeItemType(type) as StateCheckType];
  return `${placeName} ${noun.charAt(0).toUpperCase()}${noun.slice(1)}`;
}

/**
 * Asked before a section exists, because a section is almost always "the
 * round you do at a place" — and when it is, its name is that place's name.
 * Picking the location fills the name in, so the common case is one choice
 * rather than a choice plus retyping what you just chose. Either field alone
 * is enough: somewhere to be, or something to call it.
 */
function NewSectionDialog({
  locations,
  allCheckpoints,
  onCreate,
  onClose,
}: {
  locations: {
    id: string;
    name: string;
    status?: string | null;
    parent?: { id: string } | null;
  }[];
  allCheckpoints: {
    id: string;
    name: string;
    location?: { id: string; name: string } | null;
  }[];
  onCreate: (name: string, locationId?: string, checkpointIds?: string[]) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [checkpointIds, setCheckpointIds] = useState<Set<string>>(new Set());
  // Once the name has been typed in by hand it stops tracking the location —
  // silently overwriting someone's wording would be worse than not helping.
  const [nameEdited, setNameEdited] = useState(false);

  const pickLocation = (next: string) => {
    setLocationId(next);
    if (!nameEdited) setName(locations.find((l) => l.id === next)?.name ?? "");
    // A checkpoint belongs to exactly one location, so anything already
    // ticked stops being a legal choice the moment the location changes.
    setCheckpointIds(new Set());
  };

  // A section's checkpoints have to sit in its location, so there is nothing
  // to offer until there's a location to offer from.
  const checkpointChoices = locationId
    ? allCheckpoints.filter((c) => c.location?.id === locationId)
    : [];

  const trimmed = name.trim();
  const submit = () => {
    onCreate(trimmed, locationId || undefined, [...checkpointIds]);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-card"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="card-title" style={{ marginBottom: 10 }}>
          New section
        </div>

        {/* The cursor starts here, not in Name: the location is the choice
            that answers both fields, since picking it writes the name too. */}
        <div className="field">
          <span className="field-label">Location</span>
          <LocationPicker
            locations={locations}
            value={locationId}
            onChange={pickLocation}
            placeholder="Search locations…"
            autoFocus
          />
        </div>

        <div className="field">
          <span className="field-label">Name</span>
          <input
            className="input"
            value={name}
            placeholder="Section name"
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && trimmed) submit();
            }}
          />
        </div>

        <div className="field">
          <span className="field-label">Checkpoints</span>
          {!locationId ? (
            <span className="muted small">Pick a location first.</span>
          ) : checkpointChoices.length === 0 ? (
            <span className="muted small">
              No checkpoints in {locations.find((l) => l.id === locationId)?.name}.
            </span>
          ) : (
            <div className="stack" style={{ gap: 2 }}>
              {checkpointChoices.map((c) => (
                <label key={c.id} className="row" style={{ cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={checkpointIds.has(c.id)}
                    onChange={(e) =>
                      setCheckpointIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      })
                    }
                  />
                  <span className="small">{c.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!trimmed}
            onClick={submit}
          >
            Add section
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

type CopyLocation = {
  id: string;
  name: string;
  parent_id?: string | null;
  type_name?: string | null;
  retired_at?: string | null;
};

const COPY_LIST_LIMIT = 300;

/**
 * Copy a section to locations (spec § Copy a section to locations). The
 * section is the pattern; this only chooses where it goes and what to do
 * about checkpoints. The plan is `planSectionCopies`, pure, and nothing is
 * written until the button.
 */
function CopySectionDialog({
  section,
  templateId,
  templateSections,
  locations,
  allCheckpoints,
  onClose,
}: {
  section: SectionRow & { items: TemplateItemRow[] };
  templateId: string;
  /** Every section of the template, in order. */
  templateSections: SectionRow[];
  locations: CopyLocation[];
  allCheckpoints: {
    id: string;
    name: string;
    location_id?: string | null;
    gps_validation_radius?: number | null;
  }[];
  onClose: () => void;
}) {
  const { t: tA } = useTranslation("admin");
  const [parentId, setParentId] = useState("");
  const [typeName, setTypeName] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const sourceCheckpoints = section.checkpoints ?? [];
  const [mode, setMode] = useState<CheckpointMode>("none");

  const live = useMemo(() => locations.filter((l) => !l.retired_at), [locations]);
  const typeNames = useMemo(
    () =>
      [...new Set(live.map((l) => l.type_name).filter((n): n is string => Boolean(n)))].sort(
        compareNames,
      ),
    [live],
  );
  const pathOf = useMemo(() => locationPathResolver(live), [live]);
  const covered = useMemo(
    () =>
      coveredLocationIds(
        { locationId: section.location?.id ?? null },
        templateSections.map((s) => ({ locationId: s.location?.id ?? null })),
      ),
    [section.location, templateSections],
  );

  // The descendants of the parent (every depth), of the type — or everything.
  const candidates = useMemo(() => {
    let pool = live;
    if (parentId) {
      const children = new Map<string, CopyLocation[]>();
      for (const l of live) {
        if (!l.parent_id) continue;
        const list = children.get(l.parent_id) ?? [];
        list.push(l);
        children.set(l.parent_id, list);
      }
      pool = [];
      const queue = [...(children.get(parentId) ?? [])];
      const seen = new Set<string>();
      while (queue.length) {
        const l = queue.shift()!;
        if (seen.has(l.id)) continue;
        seen.add(l.id);
        pool.push(l);
        queue.push(...(children.get(l.id) ?? []));
      }
    }
    if (typeName) pool = pool.filter((l) => l.type_name === typeName);
    return pool
      .map((l) => ({ id: l.id, name: l.name, path: pathOf(l.id), covered: covered.has(l.id) }))
      .sort((a, b) => compareNames(a.path, b.path));
  }, [live, parentId, typeName, pathOf, covered]);
  const selectable = candidates.filter((c) => !c.covered);
  const tooMany = candidates.length > COPY_LIST_LIMIT;

  const chosen = candidates.filter((c) => selected.has(c.id) && !c.covered);
  const count = chosen.length;

  const submit = () => {
    const source: CopySourceSection = {
      id: section.id,
      name: section.name,
      locationId: section.location?.id ?? null,
      locationName: section.location?.name ?? null,
      isActive: section.isActive,
      triggerType: section.triggerType,
      triggerConfig:
        section.triggerConfig && Object.keys(section.triggerConfig).length > 0
          ? JSON.stringify(section.triggerConfig)
          : null,
      hideUntilRule: section.hideUntilRule ?? null,
      dueBy: section.dueBy ? JSON.stringify(section.dueBy) : null,
      items: section.items.map((i) => ({
        type: normalizeItemType(i.type) as ItemType,
        label: i.label,
        config: (i.config ?? {}) as ItemConfig,
      })),
      checkpoints: sourceCheckpoints.map((c) => ({
        id: c.id,
        name: c.name,
        gpsValidationRadius:
          allCheckpoints.find((a) => a.id === c.id)?.gps_validation_radius ?? null,
      })),
      assetIds: (section.assets ?? []).map((a) => a.id),
    };
    const plan = planSectionCopies(
      source,
      chosen.map((c) => ({ id: c.id, name: c.name })),
      mode,
      {
        templateSections: templateSections.map((s) => ({
          id: s.id,
          locationId: s.location?.id ?? null,
        })),
        checkpoints: allCheckpoints.map((c) => ({
          id: c.id,
          name: c.name,
          locationId: c.location_id ?? null,
        })),
      },
    );
    void write("copy that section", copySectionToLocations(templateId, plan));
    onClose();
  };

  const modeOption = (value: CheckpointMode, label: string, disabled = false, hint?: string) => (
    <label className="row" style={{ cursor: disabled ? "default" : "pointer", gap: 6 }}>
      <input
        type="radio"
        name="copy-checkpoints"
        checked={mode === value}
        disabled={disabled}
        onChange={() => setMode(value)}
      />
      <span className={`small${disabled ? " muted" : ""}`}>
        {label}
        {hint && <span className="muted"> — {hint}</span>}
      </span>
    </label>
  );

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog-card"
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={tA("checklistTemplates.copy.title", { name: section.name })}
      >
        <div className="card-title" style={{ marginBottom: 10 }}>
          {tA("checklistTemplates.copy.title", { name: section.name })}
        </div>

        <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <span className="field-label">{tA("checklistTemplates.copy.under")}</span>
            <LocationPicker
              locations={live}
              value={parentId}
              onChange={(next) => {
                setParentId(next);
                setSelected(new Set());
              }}
              noneLabel={tA("checklistTemplates.copy.anywhere")}
              placeholder={tA("checklistTemplates.copy.anywhere")}
              autoFocus
            />
          </div>
          <div className="field" style={{ flex: 1, minWidth: 120 }}>
            <span className="field-label">{tA("checklistTemplates.copy.type")}</span>
            <select
              className="input"
              value={typeName}
              aria-label={tA("checklistTemplates.copy.type")}
              onChange={(e) => {
                setTypeName(e.target.value);
                setSelected(new Set());
              }}
            >
              <option value="">{tA("checklistTemplates.copy.anyType")}</option>
              {typeNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <div className="spread row-nowrap">
            <span className="field-label">{tA("checklistTemplates.copy.locations")}</span>
            {!tooMany && selectable.length > 0 && (
              <span className="row" style={{ gap: 4 }}>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => setSelected(new Set(selectable.map((c) => c.id)))}
                >
                  {tA("checklistTemplates.copy.selectAll")}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => setSelected(new Set())}
                >
                  {tA("checklistTemplates.copy.clear")}
                </button>
              </span>
            )}
          </div>
          {candidates.length === 0 ? (
            <span className="muted small">{tA("checklistTemplates.copy.noCandidates")}</span>
          ) : tooMany ? (
            <span className="muted small">
              {tA("checklistTemplates.copy.tooMany", { count: candidates.length })}
            </span>
          ) : (
            <div className="stack" style={{ gap: 2, maxHeight: 260, overflowY: "auto" }}>
              {candidates.map((c) => (
                <label
                  key={c.id}
                  className="row row-nowrap"
                  style={{ cursor: c.covered ? "default" : "pointer", gap: 6 }}
                >
                  <input
                    type="checkbox"
                    checked={c.covered || selected.has(c.id)}
                    disabled={c.covered}
                    aria-label={c.path}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      })
                    }
                  />
                  <span className={`small${c.covered ? " muted" : ""}`} style={ELLIPSIS}>
                    {c.path}
                    {c.covered && (
                      <span className="muted"> · {tA("checklistTemplates.copy.alreadyHere")}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="field">
          <span className="field-label">{tA("checklistTemplates.copy.checkpoints")}</span>
          <div className="stack" style={{ gap: 4 }}>
            {modeOption("all", tA("checklistTemplates.copy.cpAll"))}
            {modeOption(
              "create",
              tA("checklistTemplates.copy.cpCreate"),
              sourceCheckpoints.length === 0,
              sourceCheckpoints.length === 0
                ? tA("checklistTemplates.copy.cpCreateDisabled")
                : tA("checklistTemplates.copy.cpCreateHint"),
            )}
            {modeOption("none", tA("checklistTemplates.copy.cpNone"))}
          </div>
        </div>

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={count === 0}
            onClick={submit}
          >
            {tA("checklistTemplates.copy.submit", { count })}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {tA("checklistTemplates.copy.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The caret that opens a section or an item — the row's only expand control.
 * One chevron that rotates rather than two swapped glyphs: the turn is what
 * tells you which way the row just went.
 */
function DisclosureToggle({
  open,
  label,
  onToggle,
}: {
  open: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="btn btn-sm btn-quiet disclosure-toggle"
      aria-expanded={open}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      <svg
        className="disclosure-caret"
        viewBox="0 0 20 20"
        width="18"
        height="18"
        aria-hidden="true"
      >
        <path
          d="M5 7.5 10 12.5 15 7.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true">
      <path
        d="M4 5.5h12M8.5 3.5h3M6 5.5l.7 10.2a1 1 0 0 0 1 .8h4.6a1 1 0 0 0 1-.8L14 5.5M8.6 8.5v5M11.4 8.5v5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * "N open checklists differ from this template. [Update them]"
 *
 * One offer for however many edits were made, never a question per edit: the
 * count is of checklists that would change, so it appears once there is
 * something to apply and clears once it has been. See the spec's "Update open
 * checklists".
 */
function OpenChecklistsBanner({ templateId }: { templateId: string }) {
  const current = useCurrent();
  const plans = useOpenChecklistPlans(templateId);
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState<number | null>(null);

  if (plans.length === 0) {
    if (updated == null) return null;
    return (
      <div className="badge badge-good" role="status" style={BANNER}>
        Updated {updated} checklist{updated === 1 ? "" : "s"}.{" "}
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => setUpdated(null)}>
          Dismiss
        </button>
      </div>
    );
  }

  const n = plans.length;
  const apply = () => {
    setBusy(true);
    write(
      "update the open checklists",
      templateWritesSettled()
        .then(() => updateOpenChecklists(templateId, current.user?.id ?? null))
        .then(setUpdated)
        .finally(() => setBusy(false)),
    );
  };
  return (
    <div className="badge badge-warn" role="status" style={BANNER}>
      <strong>
        {n} open checklist{n === 1 ? "" : "s"} differ{n === 1 ? "s" : ""} from this template.
      </strong>{" "}
      Answered items keep the wording they were answered against.{" "}
      <button type="button" className="btn btn-sm" disabled={busy} onClick={apply}>
        {busy ? "Updating…" : n === 1 ? "Update it" : "Update them"}
      </button>
    </div>
  );
}

const BANNER = { display: "block", marginBottom: 12, padding: "8px 10px", whiteSpace: "normal" } as const;

function TemplateCard({
  template,
  roles,
  locations,
  allCheckpoints,
  allAssets,
  expanded,
  onToggle,
  onDuplicated,
}: {
  template: TemplateRow;
  roles: { id: string; name: string }[];
  locations: {
    id: string;
    name: string;
    status?: string | null;
    parent?: { id: string } | null;
  }[];
  allCheckpoints: { id: string; name: string; location_id?: string | null }[];
  allAssets: { id: string; name: string }[];
  expanded: boolean;
  onToggle: () => void;
  onDuplicated: (templateId: string) => void;
}) {
  const { t: tA } = useTranslation("admin");
  const [addingViewerRoles, setAddingViewerRoles] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  // Closed to start: a template's role and trigger are set once, while its
  // sections are edited over and over.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The section just created, so it can mount already open.
  const [openedSectionId, setOpenedSectionId] = useState<string | null>(null);

  const update = (changes: Parameters<typeof saveTemplate>[1]) =>
    write("save that template", saveTemplate(template.id, changes));

  const sections = useMemo(
    () =>
      [...(template.sections ?? [])]
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
          ...s,
          items: [...(s.items ?? [])].sort((a, b) => a.order - b.order),
        })),
    [template.sections],
  );
  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);
  // What the End Shift rules read (AdminChecklistTemplatesPage.spec.md § End
  // Shift Items).
  const shape: TemplateShape = {
    trigger_type: template.triggerType,
    sections: sections.map((s) => ({
      id: s.id,
      trigger_type: s.triggerType,
      is_active: s.isActive,
      items: s.items,
    })),
  };
  const clockOutReason = clockOutBlockedReason(shape);
  const holdsEndShift = (s: { items: { type: string }[] }) =>
    s.items.some((i) => i.type === "end_shift");
  const viewerRoleIds = new Set((template.viewerRoles ?? []).map((r) => r.id));
  // The assigned role already has full access, so offering it here would only
  // let someone grant a weaker version of what it holds.
  const viewerRoleChoices = roles.filter(
    (r) => r.id !== template.assignedRole?.id && !viewerRoleIds.has(r.id),
  );

  // Named — and usually placed — before it exists, so no section is ever
  // called "New section". See NewSectionDialog. It arrives expanded: you just
  // described it, and the next thing you want is to put items in it.
  const addSection = (
    name: string,
    locationId?: string,
    checkpointIds?: string[],
  ) => {
    write(
      "add that section",
      createSection({
        templateId: template.id,
        name,
        position: sections.length,
        isActive: true,
        triggerType: "manual",
        locationId: locationId ?? null,
      }).then(async (newId) => {
        if (checkpointIds?.length) await setSectionCheckpoints(newId, checkpointIds);
        setOpenedSectionId(newId);
      }),
    );
  };

  const duplicate = async () => {
    const copyId = await duplicateTemplate(template.id, `${template.name} (copy)`);
    onDuplicated(copyId);
  };

  const remove = async () => {
    if (
      !window.confirm(
        `Delete "${template.name}"? Checklists already generated from it are unaffected.`,
      )
    )
      return;
    // The template and its sections go; item rows stay. That is not the
    // client's doing — checklist_template_items.section_id is ON DELETE SET
    // NULL, so an item survives its section exactly as a superseded version
    // survives an edit, and every checklist generated from this template keeps
    // rendering the labels it was created with.
    write("delete that template", deleteTemplate(template.id));
  };

  return (
    <div className="card">
      <div className="spread row-nowrap">
        <span className="row row-nowrap" style={{ minWidth: 0, flex: 1, gap: 6 }}>
          <DisclosureToggle
            open={expanded}
            label={expanded ? "Collapse template" : "Expand template"}
            onToggle={onToggle}
          />
          {/* The title *is* the name field once open — a separate "Name" box
              below was asking for the same string twice. */}
          {expanded ? (
            <DraftInput
              className="input select-inline"
              style={{ minWidth: 0, flex: 1 }}
              value={template.name}
              aria-label="Template name"
              onCommit={(name) => update({ name })}
            />
          ) : (
            <button
              type="button"
              className="btn-bare row row-nowrap"
              style={{ minWidth: 0, flex: 1, gap: 6 }}
              onClick={onToggle}
            >
              <span className="card-title" style={ELLIPSIS}>
                {template.name}
              </span>
            </button>
          )}
        </span>
        <span className="row row-nowrap" style={{ gap: 2, flex: "none" }}>
          <button
            type="button"
            className="btn btn-sm btn-quiet btn-icon"
            title="Duplicate this template"
            aria-label="Duplicate this template"
            onClick={() => void duplicate()}
          >
            ⧉
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet btn-icon btn-icon-danger"
            title="Delete this template"
            aria-label="Delete this template"
            onClick={() => void remove()}
          >
            <TrashIcon />
          </button>
        </span>
      </div>
      {!expanded && (
        <div className="card-meta">
          <span className="badge">{template.assignedRole?.name ?? "no role"}</span>{" "}
          {triggerLabel(TRIGGERS, template.triggerType, tA)}{" "}
          · {sections.length} section{sections.length === 1 ? "" : "s"} ·{" "}
          {itemCount} item{itemCount === 1 ? "" : "s"}
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <OpenChecklistsBanner templateId={template.id} />
          <div className="grid-2">
            <div>
              <div className="spread row-nowrap" style={{ marginBottom: 6 }}>
                <span
                  className="row row-nowrap"
                  style={{ minWidth: 0, flex: 1, gap: 6 }}
                >
                  <DisclosureToggle
                    open={settingsOpen}
                    label={settingsOpen ? "Collapse settings" : "Expand settings"}
                    onToggle={() => setSettingsOpen(!settingsOpen)}
                  />
                  <button
                    type="button"
                    className="btn-bare row row-nowrap"
                    style={{ minWidth: 0, flex: 1, gap: 6 }}
                    onClick={() => setSettingsOpen(!settingsOpen)}
                  >
                    <span className="muted small" style={ELLIPSIS}>
                      {templateSummary(template, tA)}
                    </span>
                    {(template.viewerRoles ?? []).length > 0 && (
                      <span className="badge-marquee">
                        {(template.viewerRoles ?? []).map((r) => (
                          <span key={r.id} className="badge">
                            {r.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                </span>
              </div>

              {settingsOpen && (
              <>
              <div className="field-inline">
                <span className="field-label">Role</span>
                <select
                  className="select field-control"
                  value={template.assignedRole?.id ?? ""}
                  onChange={(e) => {
                    // The placeholder option carries no id — linking it
                    // would write an empty ref.
                    if (!e.target.value) return;
                    update({ assignedRoleId: e.target.value });
                  }}
                >
                  <option value="">Pick a role…</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              {!template.assignedRole && (
                <p className="small muted" style={{ marginTop: 0, marginBottom: 6 }}>
                  Pick a role — until then these checklists are assigned to
                  whoever triggers them.
                </p>
              )}
              <label className="row" style={{ cursor: "pointer", marginBottom: 6 }}>
                <input
                  type="checkbox"
                  checked={template.assignedToUser ?? false}
                  onChange={(e) => update({ assignedToUser: e.target.checked })}
                />
                <span className="small">Assign to triggering user</span>
              </label>

              <div className="field-inline">
                <span className="field-label">Read only</span>
                <ChipMultiSelect
                  options={roles.filter((r) => r.id !== template.assignedRole?.id)}
                  selectedIds={viewerRoleIds}
                  placeholder="Nobody else"
                  emptyMessage="No other roles exist."
                  onToggle={(roleId, on) =>
                    write(
                      "change who can read this",
                      setTemplateViewerRoles(
                        template.id,
                        on
                          ? [...viewerRoleIds, roleId]
                          : [...viewerRoleIds].filter((x) => x !== roleId),
                      ),
                    )
                  }
                />
              </div>

              <div className="field-inline">
                <span className="field-label">Trigger</span>
                {/* The reason sits under the select, not beside it: beside
                    it, a sentence's width squeezed the select to its arrow. */}
                <div className="field-control">
                  <select
                    className="select"
                    value={template.triggerType}
                    onChange={(e) => update({ triggerType: e.target.value })}
                  >
                    {TRIGGERS.map((t) => (
                      <option
                        key={t.value}
                        value={t.value}
                        disabled={
                          t.value === "clock_out" &&
                          !!clockOutReason &&
                          template.triggerType !== "clock_out"
                        }
                      >
                        {triggerLabel(TRIGGERS, t.value, tA)}
                      </option>
                    ))}
                  </select>
                  {clockOutReason && template.triggerType !== "clock_out" && (
                    <div className="muted small" style={{ marginTop: 4 }}>
                      {tA(`checklistTemplates.clockOutBlocked.${clockOutReason}`)}
                    </div>
                  )}
                </div>
              </div>
              <div>
                {template.triggerType === "recurring" && (
                  <RecurrenceRuleField
                    value={
                      ((template.triggerConfig ?? {}) as { recurrenceRule?: string })
                        .recurrenceRule ?? ""
                    }
                    onCommit={(recurrenceRule) =>
                      update({
                        triggerConfig: recurrenceRule ? { recurrenceRule } : {},
                      })
                    }
                  />
                )}
                {template.triggerType === "checkpoint" && (
                  <p className="muted small" style={{ marginTop: 4 }}>
                    Triggered by scanning a checkpoint named on one of this
                    template's sections — attach checkpoints there.
                  </p>
                )}
                {template.triggerType === "asset" && (
                  <p className="muted small" style={{ marginTop: 4 }}>
                    {tA("checklistTemplates.assetTemplateHint")}
                  </p>
                )}
              </div>

              <RuleFields
                hideUntilRule={template.hideUntilRule}
                dueBy={template.dueBy}
                onHideUntilRule={(hideUntilRule) =>
                  update({ hideUntilRule: hideUntilRule || null })
                }
                onDueBy={(dueBy) => update({ dueBy: dueBy ?? null })}
                level="template"
                triggerType={template.triggerType}
                expectedStart={template.expectedStart}
                onExpectedStart={(expectedStart) =>
                  update({ expectedStart: expectedStart || null })
                }
              />
              </>
              )}
            </div>

            <div>
              <div className="section-title">Sections</div>
              {/* The per-section item count used to sit in each section's own
                  header; one total above the list says the same thing without
                  competing with the section name for room. */}
              <div className="muted small" style={{ marginBottom: 6 }}>
                {sections.length} section{sections.length === 1 ? "" : "s"} ·{" "}
                {itemCount} item{itemCount === 1 ? "" : "s"}
              </div>
              <ReorderableList
                items={sections}
                // The section holding the End Shift Item stays last.
                onReorder={(orderedIds) =>
                  write(
                    "reorder those sections",
                    reorderSections(
                      pinEndShiftLast(orderedIds, (sid) =>
                        holdsEndShift(sections.find((s) => s.id === sid) ?? { items: [] }),
                      ),
                    ),
                  )
                }
                pinned={holdsEndShift}
                renderItem={(section) => (
                  <SectionEditor
                    section={section}
                    templateId={template.id}
                    templateSections={sections}
                    templateShape={shape}
                    expectedStart={template.expectedStart}
                    defaultOpen={section.id === openedSectionId}
                    locations={locations}
                    allCheckpoints={allCheckpoints}
                    allAssets={allAssets}
                  />
                )}
              />
              {sections.length === 0 && (
                <span className="muted small">
                  No sections yet — items live inside sections.
                </span>
              )}
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => setAddingSection(true)}
                >
                  + Add section
                </button>
              </div>
              {sections.length > 1 && (
                <p className="muted small" style={{ marginTop: 4 }}>
                  Drag ⠿ to reorder.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {addingSection && (
        <NewSectionDialog
          locations={locations}
          allCheckpoints={allCheckpoints}
          onCreate={addSection}
          onClose={() => setAddingSection(false)}
        />
      )}

      {addingViewerRoles && (
        <MultiSelectDialog
          title={`Read only roles for ${template.name}`}
          options={viewerRoleChoices.map((r) => ({ id: r.id, name: r.name }))}
          onConfirm={(ids) => {
            if (ids.length > 0)
              write(
                "add those roles",
                setTemplateViewerRoles(template.id, [...viewerRoleIds, ...ids]),
              );
          }}
          onClose={() => setAddingViewerRoles(false)}
          confirmLabel="Add"
          emptyMessage="Every other role can already see this."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Sections

function SectionEditor({
  section,
  templateId,
  templateSections,
  expectedStart,
  defaultOpen = false,
  locations,
  allCheckpoints,
  allAssets,
  templateShape,
}: {
  section: SectionRow & { items: TemplateItemRow[] };
  templateId: string;
  /** Every section of the template, in order — what Copy to locations skips. */
  templateSections: SectionRow[];
  /** The whole template, for the End Shift rules. */
  templateShape: TemplateShape;
  /** The parent template's — it is what dates this section's hide-until. */
  expectedStart?: string;
  /** Just created — mount expanded rather than making you open it again. */
  defaultOpen?: boolean;
  locations: (CopyLocation & { status?: string | null })[];
  allCheckpoints: {
    id: string;
    name: string;
    location_id?: string | null;
    gps_validation_radius?: number | null;
  }[];
  allAssets: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [copying, setCopying] = useState(false);
  // Open on a section you just created — you're still describing it. Closed
  // otherwise, where the items are what you came back for.
  const [settingsOpen, setSettingsOpen] = useState(defaultOpen);
  const [addingAssets, setAddingAssets] = useState(false);
  // Which item rows have their config open. Held here rather than inside the
  // row because copy-on-edit gives an edited item a *new* id — the row that
  // was open unmounts, and only this map can hand the openness to its
  // replacement.
  const [openItemIds, setOpenItemIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // The item whose name should be focused and selected — set when a row is
  // added, cleared once the field has taken the cursor.
  const [namingItemId, setNamingItemId] = useState<string | null>(null);
  const [lastAddedType, setLastAddedType] = useState<ItemType | null>(null);
  const toggleItem = (itemId: string) =>
    setOpenItemIds((prev) => {
      const next = new Set(prev);
      if (!next.delete(itemId)) next.add(itemId);
      return next;
    });

  const update = (changes: Parameters<typeof saveSection>[1]) =>
    write("save that section", saveSection(section.id, changes));

  const { statuses } = useLocationStatuses();
  const items = section.items;
  const { t: tA } = useTranslation("admin");
  const cfg = (section.triggerConfig ?? {}) as {
    recurrenceRule?: string;
    statuses?: string[];
    event?: AssetEvent;
  };
  const selectedStatuses = new Set(cfg.statuses ?? []);
  // The standard set plus any status a location is actually sitting in, so
  // an admin-invented one is selectable without being typed twice.
  // The marina's own statuses, plus any this section already names — so a
  // status retired after the rule was written stays selected and visible
  // rather than silently dropping out of the gate.
  const statusOptions = useMemo(() => {
    const options = statuses.map((st) => ({ id: st.name, name: st.name }));
    for (const st of selectedStatuses) {
      if (!options.some((o) => o.id === st)) options.push({ id: st, name: st });
    }
    return options;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, cfg.statuses]);

  // A section belongs to exactly one location, and its checkpoints must be
  // in it — so changing the location also drops any checkpoint that isn't.
  const setLocation = (locationId: string | undefined) => {
    const keep = (section.checkpoints ?? [])
      .filter((c) => {
        const full = allCheckpoints.find((a) => a.id === c.id);
        return !locationId || full?.location_id === locationId;
      })
      .map((c) => c.id);
    write(
      "move that section",
      saveSection(section.id, { locationId: locationId ?? null }).then(() =>
        keep.length === (section.checkpoints ?? []).length
          ? undefined
          : setSectionCheckpoints(section.id, keep),
      ),
    );
  };

  const checkpointChoices = allCheckpoints.filter(
    (c) => !section.location || c.location_id === section.location.id,
  );
  const attachedCheckpointIds = new Set((section.checkpoints ?? []).map((c) => c.id));
  const attachedAssetIds = new Set((section.assets ?? []).map((a) => a.id));

  // Copy-on-edit: any change to what an item *asks* (label, config) writes a
  // new row and repoints this section's link, so instances created before
  // the edit keep the row they were created from. Order is presentation, not
  // meaning — reorders write in place.
  const versionItem = (
    item: TemplateItemRow,
    patch: { label?: string; config?: Record<string, unknown> },
  ) => track(versionItemNow(item, patch));
  const versionItemNow = async (
    item: TemplateItemRow,
    patch: { label?: string; config?: Record<string, unknown> },
  ) => {
    // Only a row some instance points at has to survive being edited — that
    // reference is the whole reason copy-on-edit exists. A template still being
    // written has none, and keeping every superseded draft would leave the
    // table full of rows no query can reach.
    const referenced = await itemHasInstances(item.id);
    if (referenced) {
      const newId = await reviseItem(
        {
          id: item.id,
          section_id: section.id,
          type: item.type as ItemType,
          label: item.label,
          config: JSON.stringify(item.config ?? {}),
          position: item.order,
          version: item.version ?? 1,
          previous_version_id: null,
        },
        {
          type: item.type as ItemType,
          label: patch.label ?? item.label,
          config: (patch.config ?? item.config ?? {}) as never,
        },
      );
      // Hand the open panel to the replacement, so the row does not blink shut.
      setOpenItemIds((prev) => {
        if (!prev.has(item.id)) return prev;
        const next = new Set(prev);
        next.delete(item.id);
        next.add(newId);
        return next;
      });
      return;
    }
    // Nothing here reads through it, so replace it — no new version, no
    // orphan. It inherits the old row's place in the version chain, which is
    // how an open checklist on an earlier version still finds this one. If an
    // older checklist this device cannot see does read through it, Postgres
    // turns the delete into an orphan.
    await write(
      "save this item's change",
      createItem({
        sectionId: section.id,
        type: item.type as ItemType,
        label: patch.label ?? item.label,
        config: (patch.config ?? item.config ?? {}) as never,
        position: item.order,
        version: item.version ?? 1,
        previousVersionId: item.previousVersionId ?? null,
      }).then(async (newId) => {
        await deleteItem(item.id);
        setOpenItemIds((prev) => {
          if (!prev.has(item.id)) return prev;
          const next = new Set(prev);
          next.delete(item.id);
          next.add(newId);
          return next;
        });
      }),
    );
  };

  // A door or lock needs a location, and the section's own location is almost
  // always the right one — so default it. Arrives open with its name selected:
  // picking a type from the menu is an intention to describe the thing, and the
  // next thing you want is the cursor in the field.
  // End Shift rules (AdminChecklistTemplatesPage.spec.md § End Shift Items):
  // hidden where it can never go, disabled with its reason where it could.
  const endShiftBlock = endShiftBlockedReason(templateShape, section.id);
  const endShiftReason = endShiftBlock
    ? tA(`checklistTemplates.endShiftBlocked.${endShiftBlock}`)
    : null;
  const menuTypes = (Object.keys(ITEM_TYPE_LABEL) as ItemType[]).filter(
    (t) => t !== "end_shift" || !endShiftHidden(templateShape),
  );
  const isEndShift = (i: { type: string }) => i.type === "end_shift";
  // Every write of this section's order goes through here, so the End Shift
  // Item stays last whatever was dropped or appended where.
  const writeOrder = (orderedIds: string[]) =>
    reorderItems(
      pinEndShiftLast(orderedIds, (iid) => items.some((i) => i.id === iid && isEndShift(i))),
    );

  const addItem = (type: ItemType) => {
    if (type === "end_shift" && endShiftReason) return;
    write(
      "add that item",
      createItem({
        sectionId: section.id,
        type,
        label: defaultItemLabel(type, section.location?.name),
        config: (type === "fleet_vehicle"
          ? { mode: "take" }
          : isStateCheck(type) && section.location
            ? { locationId: section.location.id }
            : {}) as never,
        position: items.length,
      }).then(async (newId) => {
        // Appended after an End Shift Item; move it back above.
        if (type !== "end_shift" && items.some(isEndShift)) {
          await writeOrder([...items.map((i) => i.id), newId]);
        }
        setOpenItemIds((prev) => new Set(prev).add(newId));
        setNamingItemId(newId);
        setLastAddedType(type);
      }),
    );
  };

  const duplicateItem = (item: TemplateItemRow) =>
    write(
      "duplicate that item",
      createItem({
        sectionId: section.id,
        type: item.type as ItemType,
        label: `${item.label} (copy)`,
        config: (item.config ?? {}) as never,
        position: items.length,
      }).then(async (newId) => {
        if (items.some(isEndShift)) await writeOrder([...items.map((i) => i.id), newId]);
      }),
    );

  // Removal orphans rather than deletes: instance items on already-generated
  // checklists render through this row forever. Same rule as an edit — a row no
  // instance reads through is the editor's own scratch work, and orphaning it
  // would leave exactly the litter that deleting a superseded draft avoids.
  const removeItem = (itemId: string) => track(removeItemNow(itemId));
  const removeItemNow = async (itemId: string) => {
    const referenced = await itemHasInstances(itemId);
    await write(
      "remove that item",
      referenced
        ? orphanItem(itemId)
        : deleteItem(itemId),
    );
  };

  const removeSection = () => {
    if (
      !window.confirm(
        `Delete section "${section.name}"? Checklists already generated keep their copy.`,
      )
    )
      return;
    write("delete that section", deleteSection(section.id));
  };

  return (
    <div className="card">
      <div className="spread row-nowrap">
        <span className="row row-nowrap" style={{ minWidth: 0, flex: 1, gap: 6 }}>
          <DisclosureToggle
            open={open}
            label={open ? "Collapse section" : "Expand section"}
            onToggle={() => setOpen(!open)}
          />
          {/* Closed, the name is a label with its item count; open, it's the
              field you edit. An input reading as editable only while the rest
              of the editor is on screen is the point. */}
          {open ? (
            <DraftInput
              className="input select-inline"
              style={{ minWidth: 0, flex: 1 }}
              value={section.name}
              aria-label="Section name"
              onCommit={(name) => update({ name })}
            />
          ) : (
            <button
              type="button"
              className="btn-bare row row-nowrap"
              style={{ minWidth: 0, flex: 1, gap: 6 }}
              onClick={() => setOpen(true)}
            >
              <span style={ELLIPSIS}>{section.name}</span>
              <span className="muted small" style={{ flex: "none" }}>
                | {items.length} item{items.length === 1 ? "" : "s"}
                {(section.checkpoints ?? []).length > 0 ? " ·" : ""}
              </span>
              {/* The checkpoints are the part of a section you can't guess
                  from its name — the place usually is the name. However many
                  reach the end of the line is the right number to show; the
                  rest fade out rather than wrapping the row to two lines. */}
              {(section.checkpoints ?? []).length > 0 && (
                <span className="badge-marquee">
                  {(section.checkpoints ?? []).map((c) => (
                    <span key={c.id} className="badge">
                      {c.name}
                    </span>
                  ))}
                </span>
              )}
            </button>
          )}
          {!open && !section.isActive && (
            <span className="badge" style={{ flex: "none" }}>
              Inactive
            </span>
          )}
        </span>
        {open && (
          <span className="row row-nowrap" style={{ gap: 4, flex: "none" }}>
            {/* Whether the section runs at all belongs beside its name, not
                buried under the fields that describe how it runs. */}
            <label className="row" style={{ cursor: "pointer", gap: 4 }} title="Active">
              <input
                type="checkbox"
                checked={section.isActive}
                onChange={(e) => update({ isActive: e.target.checked })}
                aria-label="Active"
              />
              <span className="small muted">Active</span>
            </label>
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setCopying(true)}
            >
              {tA("checklistTemplates.copy.action")}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-quiet btn-icon btn-icon-danger"
              title="Delete section"
              aria-label="Delete section"
              onClick={removeSection}
            >
              <TrashIcon />
            </button>
          </span>
        )}
      </div>

      {copying && (
        <CopySectionDialog
          section={section}
          templateId={templateId}
          templateSections={templateSections}
          locations={locations}
          allCheckpoints={allCheckpoints}
          onClose={() => setCopying(false)}
        />
      )}

      {open && (
        <div style={{ marginTop: 8 }}>
          {/* Same fold as the template's settings, for the same reason: the
              items are what you opened the section for. */}
          <div className="spread row-nowrap" style={{ marginBottom: 6 }}>
            <span className="row row-nowrap" style={{ minWidth: 0, flex: 1, gap: 6 }}>
              <DisclosureToggle
                open={settingsOpen}
                label={settingsOpen ? "Collapse section settings" : "Expand section settings"}
                onToggle={() => setSettingsOpen(!settingsOpen)}
              />
              <button
                type="button"
                className="btn-bare row row-nowrap"
                style={{ minWidth: 0, flex: 1, gap: 6 }}
                onClick={() => setSettingsOpen(!settingsOpen)}
              >
                <span className="muted small" style={ELLIPSIS}>
                  {sectionSummary(section, triggerLabel(SECTION_TRIGGERS, sectionTriggerValue(section.triggerType, cfg), tA))}
                </span>
                {(section.checkpoints ?? []).length > 0 && (
                  <span className="badge-marquee">
                    {(section.checkpoints ?? []).map((c) => (
                      <span key={c.id} className="badge">
                        {c.name}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            </span>
          </div>

          {settingsOpen && (
          <>
          <div className="field-inline">
            <span className="field-label">Trigger</span>
            <select
              className="select field-control"
              value={sectionTriggerValue(section.triggerType, cfg)}
              onChange={(e) => {
                const [triggerType, event] = e.target.value.split(":");
                update(
                  event
                    ? { triggerType, triggerConfig: { event: event as AssetEvent } }
                    : { triggerType },
                );
              }}
            >
              {SECTION_TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {triggerLabel(SECTION_TRIGGERS, t.value, tA)}
                </option>
              ))}
            </select>
          </div>
          <div>
            {section.triggerType === "recurring" && (
              <RecurrenceRuleField
                value={cfg.recurrenceRule ?? ""}
                onCommit={(recurrenceRule) =>
                  update({ triggerConfig: recurrenceRule ? { recurrenceRule } : {} })
                }
              />
            )}
            {section.triggerType === "location_status" && (
              <div style={{ marginTop: 6 }}>
                <div className="field-inline" style={{ marginBottom: 0 }}>
                  <span className="field-label">Runs when</span>
                  <ChipMultiSelect
                    options={statusOptions}
                    selectedIds={selectedStatuses}
                    placeholder="No statuses — never runs"
                    emptyMessage="No statuses defined."
                    onToggle={(status, on) => {
                      const next = new Set(selectedStatuses);
                      if (on) next.add(status);
                      else next.delete(status);
                      update({
                        triggerConfig: { ...cfg, statuses: [...next] },
                      });
                    }}
                  />
                </div>
                {!section.location && (
                  <div
                    className="badge badge-warn"
                    style={{ display: "block", marginTop: 6 }}
                  >
                    Set a location below — without one there's no status to
                    read, so this section never runs.
                  </div>
                )}
                {section.location && selectedStatuses.size === 0 && (
                  <div
                    className="badge badge-warn"
                    style={{ display: "block", marginTop: 6 }}
                  >
                    Pick at least one status — a gate naming none never opens.
                  </div>
                )}
                <p className="muted small" style={{ marginTop: 6, marginBottom: 0 }}>
                  Read once, when the checklist is generated. A checklist whose
                  sections are all switched off isn't created at all.
                </p>
              </div>
            )}
            {(section.triggerType === "checkpoint" ||
              section.triggerType === "location") && (
              <p className="muted small" style={{ marginTop: 4 }}>
                Created when {section.triggerType === "checkpoint" ? "one of its checkpoints is scanned" : "its location is visited"} while the
                checklist is open — set the place below.
              </p>
            )}
            {section.triggerType === "asset" && (
              <p className="muted small" style={{ marginTop: 4 }}>
                {tA(
                  (cfg.event ?? "check_out") === "check_out"
                    ? "checklistTemplates.assetSectionHint.check_out"
                    : "checklistTemplates.assetSectionHint.check_in",
                )}
              </p>
            )}
          </div>

          <RuleFields
            hideUntilRule={section.hideUntilRule}
            dueBy={section.dueBy}
            onHideUntilRule={(hideUntilRule) =>
              update({ hideUntilRule: hideUntilRule || null })
            }
            onDueBy={(dueBy) => update({ dueBy: dueBy ?? null })}
            level="section"
            triggerType={section.triggerType}
            expectedStart={expectedStart}
          />

          <div className="field-inline">
            <span className="field-label">Location</span>
            <div className="field-control">
              <LocationPicker
                locations={locations}
                value={section.location?.id ?? ""}
                onChange={(next) => setLocation(next || undefined)}
                placeholder="Search locations…"
              />
            </div>
          </div>
          <div className="field-inline">
            <span className="field-label">Checkpoints</span>
            <ChipMultiSelect
              options={checkpointChoices}
              selectedIds={attachedCheckpointIds}
              placeholder={section.location ? "None" : "Pick a location first"}
              emptyMessage={`No checkpoints in ${section.location?.name ?? "this location"}.`}
              disabled={!section.location}
              onToggle={(checkpointId, on) =>
                write(
                  on ? "attach that checkpoint" : "remove that checkpoint",
                  setSectionCheckpoints(
                    section.id,
                    on
                      ? [...attachedCheckpointIds, checkpointId]
                      : [...attachedCheckpointIds].filter((x) => x !== checkpointId),
                  ),
                )
              }
            />
          </div>

          {(section.triggerType === "asset" || (section.assets ?? []).length > 0) && (
            <div className="field">
              <span className="field-label">Assets</span>
              <div className="stack" style={{ gap: 2 }}>
                {(section.assets ?? []).map((a) => (
                  <div key={a.id} className="row spread">
                    <span className="small">{a.name}</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-quiet"
                      onClick={() =>
                        write(
                          "detach that asset",
                          setSectionAssets(
                            section.id,
                            [...attachedAssetIds].filter((x) => x !== a.id),
                          ),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginTop: 4 }}
                onClick={() => setAddingAssets(true)}
              >
                + Add assets
              </button>
            </div>
          )}

          </>
          )}

          <div className="section-title" style={{ marginTop: 10 }}>
            Items{" "}
            <span className="muted small" style={{ fontWeight: 400 }}>
              {items.length}
            </span>
          </div>
          <ReorderableList
            items={items}
            onReorder={(orderedIds) => write("reorder those items", writeOrder(orderedIds))}
            pinned={isEndShift}
            renderItem={(item) => (
              <ItemRow
                item={item}
                defaultLabel={defaultItemLabel(
                  item.type as ItemType,
                  section.location?.name,
                )}
                open={openItemIds.has(item.id)}
                onToggle={() => toggleItem(item.id)}
                autoSelectName={namingItemId === item.id}
                onNamed={() => setNamingItemId(null)}
                onEdit={versionItem}
                onDuplicate={duplicateItem}
                onRemove={removeItem}
              />
            )}
          />
          {/* An empty section is the one place the type menu is pure friction:
              there's no list to keep tidy, and every type is one tap away if
              you just show them. Once there's something in the section the
              menu comes back, because six buttons under a list of items would
              compete with the items. */}
          {items.length === 0 ? (
            <div className="placeholder" style={{ padding: "16px 12px" }}>
              <div style={{ marginBottom: 10 }}>No items yet, let's add one!</div>
              <div
                className="row"
                style={{ flexWrap: "wrap", justifyContent: "center", gap: 6 }}
              >
                {menuTypes.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="btn btn-sm"
                    disabled={t === "end_shift" && !!endShiftReason}
                    title={t === "end_shift" ? (endShiftReason ?? undefined) : undefined}
                    onClick={() => addItem(t)}
                  >
                    {ITEM_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <select
                className="select select-inline"
                value=""
                onChange={(e) => {
                  if (e.target.value) addItem(e.target.value as ItemType);
                }}
              >
                <option value="">Add an item…</option>
                {menuTypes.map((t) =>
                  t === "end_shift" && endShiftReason ? (
                    <option key={t} value={t} disabled title={endShiftReason}>
                      {tA("checklistTemplates.endShiftUnavailable", { type: ITEM_TYPE_LABEL[t] })}
                    </option>
                  ) : (
                    <option key={t} value={t}>
                      {ITEM_TYPE_LABEL[t]}
                    </option>
                  ),
                )}
              </select>
              {/* Items come in runs — four door checks for four doors — and
                  the menu resets after every use, so the second one cost the
                  same three taps as the first. */}
              {lastAddedType && lastAddedType !== "end_shift" && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => addItem(lastAddedType)}
                >
                  + another {ITEM_TYPE_LABEL[lastAddedType]}
                </button>
              )}
            </div>
          )}
          {items.length > 1 && (
            <p className="muted small" style={{ marginTop: 4 }}>
              Drag ⠿ to reorder.
            </p>
          )}
        </div>
      )}

      {addingAssets && (
        <MultiSelectDialog
          title={`Attach assets to ${section.name}`}
          options={allAssets
            .filter((a) => !attachedAssetIds.has(a.id))
            .map((a) => ({ id: a.id, name: a.name }))}
          onConfirm={(ids) => {
            if (ids.length > 0)
              write(
                "attach those assets",
                setSectionAssets(section.id, [...attachedAssetIds, ...ids]),
              );
          }}
          onClose={() => setAddingAssets(false)}
          confirmLabel="Attach"
          emptyMessage="Every asset is already attached."
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Rules

function RecurrenceRuleField({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (rule: string) => void;
}) {
  return (
    <div style={{ marginTop: 6 }}>
      <DraftInput
        className="input"
        placeholder='RRULE, e.g. "FREQ=WEEKLY;BYDAY=TU" — empty = every day'
        aria-label="Recurrence rule"
        value={value}
        onCommit={onCommit}
      />
      <p className="muted small" style={{ marginTop: 4 }}>
        Days only — time of day belongs to "Hide until" below.
      </p>
    </div>
  );
}

/**
 * The two authored time rules shared by templates and sections: hide-until
 * (WHEN the row becomes visible — creation is the trigger's business) and
 * due-by (either a clock time or an offset from creation), both resolved to
 * concrete timestamps on the instance at creation.
 */
function RuleFields({
  hideUntilRule,
  dueBy,
  onHideUntilRule,
  onDueBy,
  level,
  triggerType,
  expectedStart,
  onExpectedStart,
}: {
  hideUntilRule: string | undefined;
  dueBy: DueByRule | undefined;
  onHideUntilRule: (rule: string) => void;
  onDueBy: (rule: DueByRule | undefined) => void;
  /** Which row this is — the same trigger name means different things. */
  level: "template" | "section";
  /** What creates this row, which decides whether a hide-until is safe. */
  triggerType: string;
  /** The TEMPLATE's expected start — it dates every hide-until beneath it. */
  expectedStart: string | undefined;
  /** Present at template level only: that is where the value lives. */
  onExpectedStart?: (time: string) => void;
}) {
  const kind = dueBy?.kind ?? "";
  // Only worth saying once the rule exists — an empty field hides nothing.
  const hideWarning = hideUntilRule
    ? hideUntilWarning(level, triggerType, expectedStart)
    : undefined;
  return (
    <>
      {onExpectedStart && (
        <>
          <div className="field-inline">
            <span className="field-label">Normally started at</span>
            <div className="row field-control">
              <DraftInput
                type="time"
                className="input select-inline"
                aria-label="Time this checklist is normally started"
                value={expectedStart ?? ""}
                onCommit={onExpectedStart}
              />
              {expectedStart && (
                <button
                  type="button"
                  className="btn btn-sm btn-quiet"
                  onClick={() => onExpectedStart("")}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </>
      )}
      <div className="field-inline">
        <span className="field-label">Hide until</span>
        <div className="row field-control">
          <DraftInput
            type="time"
            className="input select-inline"
            aria-label="Hide until time of day"
            value={hideUntilRule ?? ""}
            onCommit={onHideUntilRule}
          />
          {hideUntilRule && (
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => onHideUntilRule("")}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {hideWarning && (
        <div
          className="badge badge-warn"
          style={{ display: "block", marginBottom: 6, padding: "6px 10px" }}
        >
          {hideWarning}
        </div>
      )}
      <div className="field-inline">
        <span className="field-label">Due by</span>
        <div className="row field-control">
          <select
            className="select select-inline"
            value={kind}
            onChange={(e) => {
              const next = e.target.value;
              if (!next) onDueBy(undefined);
              else if (next === "time") onDueBy({ kind: "time", time: "05:00" });
              else onDueBy({ kind: "offset", minutes: 60 });
            }}
          >
            <option value="">No due time</option>
            <option value="time">At a time of day</option>
            <option value="offset">Within X minutes</option>
          </select>
          {dueBy?.kind === "time" && (
            <DraftInput
              type="time"
              className="input select-inline"
              aria-label="Due time of day"
              value={dueBy.time}
              onCommit={(time) => time && onDueBy({ kind: "time", time })}
            />
          )}
          {dueBy?.kind === "offset" && (
            <DraftInput
              type="number"
              className="input select-inline"
              style={{ width: 90 }}
              aria-label="Due within minutes"
              value={String(dueBy.minutes)}
              onCommit={(v) => {
                const minutes = Number(v);
                if (Number.isFinite(minutes) && minutes > 0)
                  onDueBy({ kind: "offset", minutes });
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Items

function ItemRow({
  item,
  defaultLabel,
  open,
  onToggle,
  autoSelectName = false,
  onNamed,
  onEdit,
  onDuplicate,
  onRemove,
}: {
  item: TemplateItemRow;
  /** What this item would be called if nobody had renamed it. */
  defaultLabel: string;
  /** Owned by the section — see `openItemIds` there. */
  open: boolean;
  onToggle: () => void;
  /** Just added: take the cursor and select the generated name. */
  autoSelectName?: boolean;
  onNamed: () => void;
  onEdit: (
    item: TemplateItemRow,
    patch: { label?: string; config?: Record<string, unknown> },
  ) => void;
  onDuplicate: (item: TemplateItemRow) => void;
  onRemove: (itemId: string) => void;
}) {
  const cfg = (item.config ?? {}) as Record<string, unknown>;

  // A label can ride along with a config change so the pair lands as one
  // version rather than two — see the asset picker in StateCheckConfigFields.
  const setConfig = (patch: Record<string, unknown>, label?: string) =>
    onEdit(item, {
      config: { ...cfg, ...patch },
      ...(label ? { label } : {}),
    });

  // The field has the cursor by now (child effects run first), so release
  // the flag — reopening this row later shouldn't grab focus again.
  useEffect(() => {
    if (autoSelectName) onNamed();
  }, [autoSelectName, onNamed]);

  return (
    <div className="card">
      <div className="spread row-nowrap">
        <span className="row row-nowrap" style={{ minWidth: 0, flex: 1, gap: 6 }}>
          {/* Every type opens, including the ones with no config fields:
              the label is only editable while open, and simple checks have
              a label to edit like everything else. */}
          <DisclosureToggle
            open={open}
            label={open ? "Collapse item" : "Expand item"}
            onToggle={onToggle}
          />
          {open ? (
            <DraftInput
              className="input select-inline"
              style={{ minWidth: 0, flex: 1 }}
              value={item.label}
              aria-label="Item label"
              // Copy-on-edit replaces this row, remounting the input — so a
              // debounced write mid-word would drop focus and close the
              // phone keyboard on every keystroke. Write on blur instead.
              commitOnBlurOnly
              autoSelect={autoSelectName}
              onCommit={(label) => {
                if (label !== item.label) onEdit(item, { label });
              }}
            />
          ) : (
            <button
              type="button"
              className="btn-bare"
              // Wraps rather than ellipsizing: three levels of card padding
              // leave this row under 200px on a phone, and half a label is
              // no use in a list you collapsed in order to scan it.
              style={{ minWidth: 0, flex: 1 }}
              onClick={onToggle}
            >
              {item.label}
            </button>
          )}
        </span>
        <span className="row row-nowrap" style={{ gap: 4, flex: "none" }}>
          {/* Between the name and the controls: it qualifies the name, and
              inside the config panel it only said what the fields under it
              already implied. */}
          <span className="badge">{itemTypeLabel(item.type)}</span>
          {/* One End Shift Item per template: nothing to duplicate. */}
          {item.type !== "end_shift" && (
            <button
              type="button"
              className="btn btn-sm btn-quiet btn-icon"
              title="Duplicate this item"
              aria-label="Duplicate this item"
              onClick={() => onDuplicate(item)}
            >
              ⧉
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-quiet btn-icon btn-icon-danger"
            title="Remove this item"
            aria-label="Remove this item"
            onClick={() => onRemove(item.id)}
          >
            <TrashIcon />
          </button>
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 8 }}>
          {isStateCheck(item.type) && (
            <StateCheckConfigFields
              kind={normalizeItemType(item.type) as StateCheckType}
              cfg={cfg}
              setConfig={setConfig}
              label={item.label}
              defaultLabel={defaultLabel}
            />
          )}
          {item.type === "verify_task" && (
            <label className="row" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={Boolean(cfg.requireAttemptBeforeReject)}
                onChange={(e) =>
                  setConfig({ requireAttemptBeforeReject: e.target.checked })
                }
              />
              <span className="small">
                Prompt the user to attempt it themselves before rejecting
              </span>
            </label>
          )}
          {item.type === "location_check" && (
            <LocationCheckConfig cfg={cfg} setConfig={setConfig} />
          )}
          {item.type === "meter_reading" && <MeterConfig cfg={cfg} setConfig={setConfig} />}
          {item.type === "fleet_vehicle" && (
            <FleetModeConfig cfg={cfg} label={item.label} setConfig={setConfig} />
          )}
          {item.type === "question" && (
            <QuestionConfigFields cfg={cfg} setConfig={setConfig} />
          )}
        </div>
      )}
    </div>
  );
}

// A door or pump isn't its own entity — it's a labelled item here — so
// binding it to a Location is what gives a mismatch incident something to
// attach to, and what lets reports group findings by building. Required, and
// flagged below when missing, because without it the guard would otherwise
// have been asked to pick one mid-round.
function StateCheckConfigFields({
  kind,
  cfg,
  setConfig,
  label,
  defaultLabel,
}: {
  kind: StateCheckType;
  cfg: Record<string, unknown>;
  setConfig: (patch: Record<string, unknown>, label?: string) => void;
  label: string;
  defaultLabel: string;
}) {
  const spec = STATE_CHECK_KINDS[kind];
  const { data: allLocations } = useLocations();
  const { data: allAssets } = useAssets();
  const locations = useMemo(
    () => [...allLocations].sort((a, b) => compareNames(a.name, b.name)),
    [allLocations],
  );
  const assets = useMemo(
    () => [...allAssets].sort((a, b) => compareNames(a.name, b.name)),
    [allAssets],
  );
  const locationId = (cfg.locationId as string) ?? "";
  const assetId = (cfg.assetId as string) ?? "";
  // A lock is often a thing the marina already tracks — a gate padlock, a
  // shed hasp — so it can hang off the asset instead of, or as well as, a
  // place. Doors are part of a building, not assets of their own.
  const supportsAsset = kind === "lock_check";

  const pickAsset = (nextId: string) => {
    const asset = assets.find((a) => a.id === nextId);
    // Only rename while the name is still the one we generated: once it's
    // been written by hand it's the author's, not ours to overwrite.
    const rename =
      asset && label === defaultLabel
        ? `${asset.name} ${spec.noun.charAt(0).toUpperCase()}${spec.noun.slice(1)}`
        : undefined;
    setConfig({ assetId: nextId || undefined }, rename);
  };

  // Legacy rows carry one state and a flag; read them as the pair they were
  // standing in for so an unmigrated item shows what it actually does.
  const legacy = cfg.finalState == null;
  const finalState =
    (cfg.finalState as string) ?? (cfg.expectedState as string) ?? spec.defaultState;
  const expectedState = legacy
    ? cfg.finalStateOnly === true
      ? ""
      : ((cfg.expectedState as string) ?? spec.defaultState)
    : ((cfg.expectedState as string) ?? "");

  // The fields run in the order the guard meets them: which {noun} is it,
  // what should it be when you get there, what should it be when you leave.
  return (
    <div>
      <div className="field-inline" style={{ marginBottom: 0 }}>
        <span className="field-label">Location</span>
        <div className="field-control">
          <LocationPicker
            locations={locations}
            value={locationId}
            onChange={(next) => setConfig({ locationId: next || undefined })}
            placeholder="Search locations…"
            allowNone={supportsAsset}
          />
        </div>
      </div>
      {supportsAsset && (
        <div className="field-inline" style={{ marginTop: 8, marginBottom: 0 }}>
          <span className="field-label">Asset</span>
          <select
            className="select field-control"
            value={assetId}
            onChange={(e) => pickAsset(e.target.value)}
          >
            <option value="">None</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {!locationId && !(supportsAsset && assetId) && (
        <div className="badge badge-warn" style={{ display: "block", marginTop: 6 }}>
          Set a {supportsAsset ? "location or an asset" : "location"} — without
          one, an incident raised for this {spec.noun} has nothing to attach to.
        </div>
      )}
      <div className="field-inline" style={{ marginTop: 8, marginBottom: 0 }}>
        <span className="field-label">Expected State</span>
        <select
          className="select select-inline"
          value={expectedState}
          onChange={(e) =>
            // None is the absence of the key, not a value of its own — one
            // way to say "no found expectation" instead of two that can
            // contradict each other.
            setConfig({
              expectedState: e.target.value || undefined,
              finalState,
              finalStateOnly: undefined,
            })
          }
        >
          <option value="">None</option>
          {spec.states.map((st) => (
            <option key={st} value={st}>
              {st.charAt(0).toUpperCase() + st.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <div className="field-inline" style={{ marginTop: 8, marginBottom: 0 }}>
        <span className="field-label">Final State</span>
        <select
          className="select select-inline"
          value={finalState}
          onChange={(e) =>
            setConfig({
              finalState: e.target.value,
              expectedState: expectedState || undefined,
              finalStateOnly: undefined,
            })
          }
        >
          {spec.states.map((st) => (
            <option key={st} value={st}>
              {st.charAt(0).toUpperCase() + st.slice(1)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function LocationCheckConfig({
  cfg,
  setConfig,
}: {
  cfg: Record<string, unknown>;
  setConfig: (patch: Record<string, unknown>) => void;
}) {
  // A flat <select> of every location is unusable past a hundred slips, and
  // it can't disambiguate the "Slip 14" that exists on every dock — which is
  // exactly what LocationPicker's ancestor paths are for.
  const { data: allLocations } = useLocations();
  const { data: templates } = useTemplates();
  const locations = useMemo(
    () => [...allLocations].sort((a, b) => compareNames(a.name, b.name)),
    [allLocations],
  );

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="field" style={{ marginBottom: 0 }}>
        <span className="field-label">Scoped to location</span>
        <LocationPicker
          locations={locations}
          value={(cfg.locationId as string) ?? ""}
          onChange={(next) => setConfig({ locationId: next || undefined })}
          placeholder="Search locations…"
        />
      </div>
      <select
        className="select select-inline"
        value={(cfg.templateId as string) ?? ""}
        onChange={(e) => setConfig({ templateId: e.target.value || undefined })}
      >
        <option value="">Nested template…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * A question's whole configuration is the shape of its answer — the question
 * itself is the item's name. Yes/No adds one more choice, because the answer
 * that needs explaining is usually only one of the two.
 */
function QuestionConfigFields({
  cfg,
  setConfig,
}: {
  cfg: Record<string, unknown>;
  setConfig: (patch: Record<string, unknown>) => void;
}) {
  const answerType = ((cfg.answerType as QuestionAnswerType) ??
    "single_line") as QuestionAnswerType;
  const detailsOn = ((cfg.detailsOn as YesNoDetailsOn) ?? "none") as YesNoDetailsOn;
  const step = (cfg.step as number) ?? 1;

  return (
    <div>
      <div className="field-inline" style={{ marginBottom: 0 }}>
        <span className="field-label">Answer</span>
        <select
          className="select field-control"
          value={answerType}
          onChange={(e) => setConfig({ answerType: e.target.value })}
        >
          {(Object.keys(QUESTION_ANSWER_LABEL) as QuestionAnswerType[]).map((t) => (
            <option key={t} value={t}>
              {QUESTION_ANSWER_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      {answerType === "yes_no" && (
        <div className="field-inline" style={{ marginTop: 8, marginBottom: 0 }}>
          <span className="field-label">Require details</span>
          <select
            className="select field-control"
            value={detailsOn}
            onChange={(e) => setConfig({ detailsOn: e.target.value })}
          >
            {(Object.keys(YES_NO_DETAILS_LABEL) as YesNoDetailsOn[]).map((t) => (
              <option key={t} value={t}>
                {YES_NO_DETAILS_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
      )}

      {answerType === "number" && (
        <div className="field-inline" style={{ marginTop: 8, marginBottom: 0 }}>
          <span className="field-label">Step</span>
          <DraftNumberInput
            className="input select-inline"
            style={{ width: 90 }}
            aria-label="Step"
            value={step}
            onCommit={(next) => setConfig({ step: next && next > 0 ? next : undefined })}
          />
        </div>
      )}

      {answerType === "repeatable_line" && (
        <p className="muted small" style={{ marginTop: 6, marginBottom: 0 }}>
          The user gets one box and an "Add another line" button, so entries
          can be added through the shift without disturbing earlier ones.
        </p>
      )}
    </div>
  );
}

/**
 * A Fleet Vehicle Item's one setting. A label still reading as its old mode's
 * default follows the mode; one the editor typed is left alone.
 */
function FleetModeConfig({
  cfg,
  label,
  setConfig,
}: {
  cfg: Record<string, unknown>;
  label: string;
  setConfig: (patch: Record<string, unknown>, label?: string) => void;
}) {
  const { t } = useTranslation("admin");
  const { t: tc } = useTranslation("checklists");
  const mode = fleetItemMode(cfg as FleetVehicleConfig);
  const defaultLabel = (m: FleetItemMode) =>
    dataT(fleetDefaultLabelKey(m) as "fleet.defaultLabel.take", { ns: "checklists" });
  return (
    <div className="field-inline">
      <span className="field-label">{t("checklistTemplates.fleetMode")}</span>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {FLEET_ITEM_MODES.map((m) => (
          <button
            key={m}
            type="button"
            className={"btn btn-sm" + (m === mode ? " btn-primary" : "")}
            aria-pressed={m === mode}
            onClick={() => {
              if (m === mode) return;
              setConfig({ mode: m }, label === defaultLabel(mode) ? defaultLabel(m) : undefined);
            }}
          >
            {tc(`fleet.mode.${m}`)}
          </button>
        ))}
      </div>
    </div>
  );
}

function MeterConfig({
  cfg,
  setConfig,
}: {
  cfg: Record<string, unknown>;
  setConfig: (patch: Record<string, unknown>) => void;
}) {
  const { data: allAssets } = useAssets();
  const metered = allAssets.filter((a) => a.has_meter === 1);
  return (
    <div className="row">
      <select
        className="select select-inline"
        value={(cfg.assetId as string) ?? ""}
        onChange={(e) => setConfig({ assetId: e.target.value || undefined })}
      >
        <option value="">Selected at completion</option>
        {metered.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A trigger option's label: its own, or its catalog key's. */
function triggerLabel(
  options: TriggerOption[],
  value: string,
  t: (key: AdminKey) => string,
): string {
  const option = options.find((o) => o.value === value);
  if (!option) return value;
  return "labelKey" in option ? t(option.labelKey) : option.label;
}
