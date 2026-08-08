import { useEffect, useMemo, useRef, useState } from "react";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import {
  ITEM_TYPE_LABEL,
  STATE_CHECK_KINDS,
  isStateCheck,
  itemTypeLabel,
  normalizeItemType,
  type DueByRule,
  type ItemType,
  type StateCheckType,
} from "../../lib/checklists";
import { LocationPicker } from "../shared/LocationPicker";
import { MultiSelectDialog } from "../shared/MultiSelectDialog";
import { ReorderableList } from "../shared/ReorderableList";
import { AdminHeader } from "./AdminHomePage";
import { DraftInput } from "../shared/DraftInput";

// Admin — Checklist Templates (see docs/pages/admin-checklist-templates.html).
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

  const { data } = db.useQuery({
    checklistTemplates: {
      assignedRole: {},
      viewerRoles: {},
      creator: {},
      sections: { location: {}, checkpoints: {}, assets: {}, items: {} },
    },
    roles: {},
    checkpoints: { location: {} },
    locations: { parent: {}, type: {} },
    assets: {},
  });

  const templates = useMemo(
    () =>
      [...(data?.checklistTemplates ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [data],
  );

  const roles = data?.roles ?? [];
  const locations = useMemo(
    () =>
      [...(data?.locations ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  const allCheckpoints = useMemo(
    () =>
      [...(data?.checkpoints ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      ),
    [data],
  );
  const allAssets = useMemo(
    () => [...(data?.assets ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  // Created with a placeholder name and opened straight into the editor,
  // where the name field already lives — a prompt first would just be a
  // modal asking for something the next screen also asks for. The required
  // role is asked for in the editor too, with a warning until it's set.
  const create = async () => {
    const templateId = id();
    await db.transact(
      db.tx.checklistTemplates[templateId]
        .update({
          name: "New template",
          triggerType: "manual",
          assignedToUser: true,
        })
        .link(current.user ? { creator: current.user.id } : {}),
    );
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
            Templates generate the real checklists guards work through.
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
  config?: Record<string, unknown>;
};

type SectionRow = {
  id: string;
  name: string;
  order: number;
  isActive: boolean;
  triggerType: string;
  triggerConfig?: Record<string, unknown>;
  hideUntilRule?: string;
  dueBy?: DueByRule;
  location?: { id: string; name: string } | null;
  checkpoints?: { id: string; name: string }[];
  assets?: { id: string; name: string }[];
  items?: TemplateItemRow[];
};

type TemplateRow = {
  id: string;
  name: string;
  triggerType: string;
  triggerConfig?: Record<string, unknown>;
  assignedToUser?: boolean;
  hideUntilRule?: string;
  dueBy?: DueByRule;
  assignedRole?: { id: string; name: string } | null;
  viewerRoles?: { id: string; name: string }[];
  creator?: { id: string; name: string } | null;
  sections?: SectionRow[];
};

const TRIGGERS = [
  { value: "manual", label: "Manual" },
  { value: "clock_in", label: "Clock In" },
  { value: "clock_out", label: "Clock Out" },
  { value: "checkpoint", label: "Checkpoint visit" },
  { value: "recurring", label: "Recurring" },
];

const SECTION_TRIGGERS = [
  { value: "manual", label: "Always (with the checklist)" },
  { value: "recurring", label: "Recurring days" },
  { value: "checkpoint", label: "Checkpoint scan" },
  { value: "location", label: "Location visit" },
  { value: "asset", label: "Asset" },
];

const ELLIPSIS = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

/**
 * Runs a write and says so when it fails.
 *
 * Every mutation here used to be `void db.transact(...)`, which throws the
 * promise away. Instant applies writes optimistically, so a rejected one
 * rolls back — the row you just edited silently reverts or vanishes, with
 * nothing in the UI and only an anonymous unhandled rejection in the
 * console. Copy-on-edit makes that worse: the failing transaction both
 * creates the new row and unlinks the old, so a partial refusal reads as
 * "my item disappeared". Failures are announced now, with the operation
 * that caused them.
 */
let reportWriteError: ((message: string) => void) | null = null;

/**
 * Whether any instance item still reads through this template row — the one
 * thing that decides whether a superseded or removed row has to be kept.
 *
 * Asked per edit rather than joined into the page query: `items: { instances:
 * {} }` there would drag every instance row ever generated from every
 * template into the editor. On any doubt this answers "yes" — orphaning a
 * draft row is untidy, deleting one a checklist still renders through is a
 * broken checklist.
 */
async function hasInstances(itemId: string) {
  try {
    const { data } = await db.queryOnce({
      checklistTemplateItems: { $: { where: { id: itemId } }, instances: {} },
    });
    return (data.checklistTemplateItems[0]?.instances ?? []).length > 0;
  } catch {
    return true;
  }
}

function write(what: string, tx: Parameters<typeof db.transact>[0]) {
  void db.transact(tx).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`checklist templates — ${what} failed:`, err);
    reportWriteError?.(`Couldn't ${what}: ${message}`);
  });
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
function templateSummary(template: TemplateRow) {
  const parts = [
    template.assignedRole?.name ?? "no role",
    TRIGGERS.find((t) => t.value === template.triggerType)?.label ??
      template.triggerType,
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
  locations: { id: string; name: string; parent?: { id: string } | null }[];
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
  locations: { id: string; name: string; parent?: { id: string } | null }[];
  allCheckpoints: { id: string; name: string; location?: { id: string; name: string } | null }[];
  allAssets: { id: string; name: string }[];
  expanded: boolean;
  onToggle: () => void;
  onDuplicated: (templateId: string) => void;
}) {
  const [addingViewerRoles, setAddingViewerRoles] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  // Closed to start: a template's role and trigger are set once, while its
  // sections are edited over and over.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The section just created, so it can mount already open.
  const [openedSectionId, setOpenedSectionId] = useState<string | null>(null);

  const update = (fields: Record<string, unknown>) =>
    void db.transact(db.tx.checklistTemplates[template.id].update(fields));

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
    const newId = id();
    write(
      "add that section",
      db.tx.checklistTemplateSections[newId]
        .update({
          name,
          order: sections.length,
          isActive: true,
          triggerType: "manual",
        })
        .link({
          template: template.id,
          ...(locationId ? { location: locationId } : {}),
          ...(checkpointIds?.length ? { checkpoints: checkpointIds } : {}),
        }),
    );
    setOpenedSectionId(newId);
  };

  const duplicate = async () => {
    const copyId = id();
    await db.transact([
      db.tx.checklistTemplates[copyId]
        .update({
          name: `${template.name} (copy)`,
          triggerType: template.triggerType,
          triggerConfig: template.triggerConfig ?? {},
          assignedToUser: template.assignedToUser ?? false,
          ...(template.hideUntilRule ? { hideUntilRule: template.hideUntilRule } : {}),
          ...(template.dueBy ? { dueBy: template.dueBy } : {}),
        })
        .link({
          ...(template.assignedRole ? { assignedRole: template.assignedRole.id } : {}),
          ...(template.viewerRoles?.length
            ? { viewerRoles: template.viewerRoles.map((r) => r.id) }
            : {}),
          ...(template.creator ? { creator: template.creator.id } : {}),
        }),
      // Sections and items are their own entities, so a copy needs its own
      // set rather than links to the originals' — editing the copy must not
      // touch the template it came from. Copied items restart at version 1
      // with no previousVersion: the copy has no history of its own.
      ...sections.flatMap((s) => {
        const sectionCopyId = id();
        return [
          db.tx.checklistTemplateSections[sectionCopyId]
            .update({
              name: s.name,
              order: s.order,
              isActive: s.isActive,
              triggerType: s.triggerType,
              triggerConfig: s.triggerConfig ?? {},
              ...(s.hideUntilRule ? { hideUntilRule: s.hideUntilRule } : {}),
              ...(s.dueBy ? { dueBy: s.dueBy } : {}),
            })
            .link({
              template: copyId,
              ...(s.location ? { location: s.location.id } : {}),
              ...(s.checkpoints?.length
                ? { checkpoints: s.checkpoints.map((c) => c.id) }
                : {}),
              ...(s.assets?.length ? { assets: s.assets.map((a) => a.id) } : {}),
            }),
          ...s.items.map((it, i) =>
            db.tx.checklistTemplateItems[id()]
              .update({
                type: it.type,
                label: it.label,
                order: i,
                version: 1,
                config: it.config ?? {},
              })
              .link({ section: sectionCopyId }),
          ),
        ];
      }),
    ]);
    onDuplicated(copyId);
  };

  const remove = async () => {
    if (
      !window.confirm(
        `Delete "${template.name}"? Checklists already generated from it are unaffected.`,
      )
    )
      return;
    // The template and its sections go; item rows stay — instance items of
    // already-generated checklists render their label/type/config through
    // them, the same way superseded versions survive an edit.
    await db.transact([
      ...sections.map((s) => db.tx.checklistTemplateSections[s.id].delete()),
      db.tx.checklistTemplates[template.id].delete(),
    ]);
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
          {TRIGGERS.find((t) => t.value === template.triggerType)?.label ??
            template.triggerType}{" "}
          · {sections.length} section{sections.length === 1 ? "" : "s"} ·{" "}
          {itemCount} item{itemCount === 1 ? "" : "s"}
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 12 }}>
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
                      {templateSummary(template)}
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
                    void db.transact(
                      db.tx.checklistTemplates[template.id].link({
                        assignedRole: e.target.value,
                      }),
                    );
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
                    void db.transact(
                      on
                        ? db.tx.checklistTemplates[template.id].link({
                            viewerRoles: roleId,
                          })
                        : db.tx.checklistTemplates[template.id].unlink({
                            viewerRoles: roleId,
                          }),
                    )
                  }
                />
              </div>

              <div className="field-inline">
                <span className="field-label">Trigger</span>
                <select
                  className="select field-control"
                  value={template.triggerType}
                  onChange={(e) => update({ triggerType: e.target.value })}
                >
                  {TRIGGERS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
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
              </div>

              <RuleFields
                hideUntilRule={template.hideUntilRule}
                dueBy={template.dueBy}
                onHideUntilRule={(hideUntilRule) =>
                  update({ hideUntilRule: hideUntilRule || null })
                }
                onDueBy={(dueBy) => update({ dueBy: dueBy ?? null })}
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
                onReorder={(orderedIds) =>
                  void db.transact(
                    orderedIds.map((sectionId, i) =>
                      db.tx.checklistTemplateSections[sectionId].update({ order: i }),
                    ),
                  )
                }
                renderItem={(section) => (
                  <SectionEditor
                    section={section}
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
              void db.transact(
                db.tx.checklistTemplates[template.id].link({ viewerRoles: ids }),
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
  defaultOpen = false,
  locations,
  allCheckpoints,
  allAssets,
}: {
  section: SectionRow & { items: TemplateItemRow[] };
  /** Just created — mount expanded rather than making you open it again. */
  defaultOpen?: boolean;
  locations: { id: string; name: string; parent?: { id: string } | null }[];
  allCheckpoints: { id: string; name: string; location?: { id: string; name: string } | null }[];
  allAssets: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(defaultOpen);
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

  const update = (fields: Record<string, unknown>) =>
    void db.transact(db.tx.checklistTemplateSections[section.id].update(fields));

  const items = section.items;
  const cfg = (section.triggerConfig ?? {}) as { recurrenceRule?: string };

  // A section belongs to exactly one location, and its checkpoints must be
  // in it — so changing the location also drops any checkpoint that isn't.
  const setLocation = (locationId: string | undefined) => {
    const stale = (section.checkpoints ?? []).filter((c) => {
      const full = allCheckpoints.find((a) => a.id === c.id);
      return locationId ? full?.location?.id !== locationId : false;
    });
    void db.transact([
      ...(locationId
        ? [db.tx.checklistTemplateSections[section.id].link({ location: locationId })]
        : section.location
          ? [
              db.tx.checklistTemplateSections[section.id].unlink({
                location: section.location.id,
              }),
            ]
          : []),
      ...stale.map((c) =>
        db.tx.checklistTemplateSections[section.id].unlink({ checkpoints: c.id }),
      ),
    ]);
  };

  const checkpointChoices = allCheckpoints.filter(
    (c) => !section.location || c.location?.id === section.location.id,
  );
  const attachedCheckpointIds = new Set((section.checkpoints ?? []).map((c) => c.id));
  const attachedAssetIds = new Set((section.assets ?? []).map((a) => a.id));

  // Copy-on-edit: any change to what an item *asks* (label, config) writes a
  // new row and repoints this section's link, so instances created before
  // the edit keep the row they were created from. Order is presentation, not
  // meaning — reorders write in place.
  const versionItem = async (
    item: TemplateItemRow,
    patch: { label?: string; config?: Record<string, unknown> },
  ) => {
    const newId = id();
    // Hand the open panel to the replacement before anything awaits, so the
    // row doesn't blink shut while the check below runs.
    setOpenItemIds((prev) => {
      if (!prev.has(item.id)) return prev;
      const next = new Set(prev);
      next.delete(item.id);
      next.add(newId);
      return next;
    });

    // Only a row some instance points at has to survive being edited — that
    // reference is the whole reason copy-on-edit exists. A template still
    // being written has none, and keeping every superseded draft would leave
    // the namespace full of rows no query can reach.
    const referenced = await hasInstances(item.id);

    write("save this item's change", [
      db.tx.checklistTemplateItems[newId]
        .update({
          type: item.type,
          label: patch.label ?? item.label,
          order: item.order,
          version: (item.version ?? 1) + 1,
          config: patch.config ?? item.config ?? {},
        })
        // No previousVersion when the old row is going away — the link would
        // only point at a hole.
        .link({
          section: section.id,
          ...(referenced ? { previousVersion: item.id } : {}),
        }),
      referenced
        ? db.tx.checklistTemplateItems[item.id].unlink({ section: section.id })
        : db.tx.checklistTemplateItems[item.id].delete(),
    ]);
  };

  // A door or lock needs a Location, and the section's own location is
  // almost always the right one — so default it.
  // Arrives open with its name selected: picking a type from the menu is an
  // intention to describe the thing, and the next thing you want is the
  // cursor in the field, not a second tap to get there.
  const addItem = (type: ItemType) => {
    const newId = id();
    write(
      "add that item",
      db.tx.checklistTemplateItems[newId]
        .update({
          type,
          label: defaultItemLabel(type, section.location?.name),
          order: items.length,
          version: 1,
          config:
            isStateCheck(type) && section.location
              ? { locationId: section.location.id }
              : {},
        })
        .link({ section: section.id }),
    );
    setOpenItemIds((prev) => new Set(prev).add(newId));
    setNamingItemId(newId);
    setLastAddedType(type);
  };

  const duplicateItem = (item: TemplateItemRow) =>
    write("duplicate that item", 
      db.tx.checklistTemplateItems[id()]
        .update({
          type: item.type,
          label: `${item.label} (copy)`,
          order: items.length,
          version: 1,
          config: item.config ?? {},
        })
        .link({ section: section.id }),
    );

  // Removal unlinks rather than deletes: instance items on already-generated
  // checklists render through this row forever.
  // Same rule as an edit: a row no instance reads through is the editor's
  // own scratch work, and unlinking it would leave exactly the orphan that
  // deleting the superseded version was meant to stop.
  const removeItem = async (itemId: string) => {
    write(
      "remove that item",
      (await hasInstances(itemId))
        ? db.tx.checklistTemplateItems[itemId].unlink({ section: section.id })
        : db.tx.checklistTemplateItems[itemId].delete(),
    );
  };

  const removeSection = () => {
    if (
      !window.confirm(
        `Delete section "${section.name}"? Checklists already generated keep their copy.`,
      )
    )
      return;
    write("delete that section", db.tx.checklistTemplateSections[section.id].delete());
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
                  {sectionSummary(
                    section,
                    SECTION_TRIGGERS.find((t) => t.value === section.triggerType)
                      ?.label ?? section.triggerType,
                  )}
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
              value={section.triggerType}
              onChange={(e) => update({ triggerType: e.target.value })}
            >
              {SECTION_TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
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
            {(section.triggerType === "checkpoint" ||
              section.triggerType === "location") && (
              <p className="muted small" style={{ marginTop: 4 }}>
                Created when {section.triggerType === "checkpoint" ? "one of its checkpoints is scanned" : "its location is visited"} while the
                checklist is open — set the place below.
              </p>
            )}
            {section.triggerType === "asset" && (
              <p className="muted small" style={{ marginTop: 4 }}>
                Nothing creates asset sections automatically yet — attach the
                assets below so it's ready when that lands.
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
                  on
                    ? db.tx.checklistTemplateSections[section.id].link({
                        checkpoints: checkpointId,
                      })
                    : db.tx.checklistTemplateSections[section.id].unlink({
                        checkpoints: checkpointId,
                      }),
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
                        void db.transact(
                          db.tx.checklistTemplateSections[section.id].unlink({
                            assets: a.id,
                          }),
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
            onReorder={(orderedIds) =>
              void db.transact(
                orderedIds.map((itemId, i) =>
                  db.tx.checklistTemplateItems[itemId].update({ order: i }),
                ),
              )
            }
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
                {(Object.keys(ITEM_TYPE_LABEL) as ItemType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="btn btn-sm"
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
                {(Object.keys(ITEM_TYPE_LABEL) as ItemType[]).map((t) => (
                  <option key={t} value={t}>
                    {ITEM_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              {/* Items come in runs — four door checks for four doors — and
                  the menu resets after every use, so the second one cost the
                  same three taps as the first. */}
              {lastAddedType && (
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
              void db.transact(
                db.tx.checklistTemplateSections[section.id].link({ assets: ids }),
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
}: {
  hideUntilRule: string | undefined;
  dueBy: DueByRule | undefined;
  onHideUntilRule: (rule: string) => void;
  onDueBy: (rule: DueByRule | undefined) => void;
}) {
  const kind = dueBy?.kind ?? "";
  return (
    <>
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
          <button
            type="button"
            className="btn btn-sm btn-quiet btn-icon"
            title="Duplicate this item"
            aria-label="Duplicate this item"
            onClick={() => onDuplicate(item)}
          >
            ⧉
          </button>
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
                Prompt the guard to attempt it themselves before rejecting
              </span>
            </label>
          )}
          {item.type === "location_check" && (
            <LocationCheckConfig cfg={cfg} setConfig={setConfig} />
          )}
          {item.type === "meter_reading" && <MeterConfig cfg={cfg} setConfig={setConfig} />}
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
  const { data } = db.useQuery({
    locations: { parent: {}, type: {} },
    assets: {},
  });
  const locations = useMemo(
    () => [...(data?.locations ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  const assets = useMemo(
    () => [...(data?.assets ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
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
  const { data } = db.useQuery({
    locations: { parent: {}, type: {} },
    checklistTemplates: {},
  });
  const locations = useMemo(
    () => [...(data?.locations ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
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
        {(data?.checklistTemplates ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
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
  const { data } = db.useQuery({ assets: { $: { where: { hasMeter: true } } } });
  return (
    <div className="row">
      <select
        className="select select-inline"
        value={(cfg.assetId as string) ?? ""}
        onChange={(e) => setConfig({ assetId: e.target.value || undefined })}
      >
        <option value="">Guard picks the asset at completion time</option>
        {(data?.assets ?? []).map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
