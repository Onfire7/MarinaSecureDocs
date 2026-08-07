import { useMemo, useState } from "react";
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
import { locationPathResolver } from "../../lib/checkpoints";

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
  const pathOf = useMemo(
    () => locationPathResolver(data?.locations ?? []),
    [data],
  );
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

      <div className="stack" style={{ gap: 8 }}>
        {templates.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            roles={roles}
            locations={locations}
            allCheckpoints={allCheckpoints}
            allAssets={allAssets}
            pathOf={pathOf}
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
  assignedToUser: boolean;
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

function TemplateCard({
  template,
  roles,
  locations,
  allCheckpoints,
  allAssets,
  pathOf,
  expanded,
  onToggle,
  onDuplicated,
}: {
  template: TemplateRow;
  roles: { id: string; name: string }[];
  locations: { id: string; name: string; parent?: { id: string } | null }[];
  allCheckpoints: { id: string; name: string; location?: { id: string; name: string } | null }[];
  allAssets: { id: string; name: string }[];
  pathOf: (locationId: string) => string;
  expanded: boolean;
  onToggle: () => void;
  onDuplicated: (templateId: string) => void;
}) {
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

  const addSection = () =>
    void db.transact(
      db.tx.checklistTemplateSections[id()]
        .update({
          name: "New section",
          order: sections.length,
          isActive: true,
          triggerType: "manual",
        })
        .link({ template: template.id }),
    );

  const duplicate = async () => {
    const copyId = id();
    await db.transact([
      db.tx.checklistTemplates[copyId]
        .update({
          name: `${template.name} (copy)`,
          triggerType: template.triggerType,
          triggerConfig: template.triggerConfig ?? {},
          assignedToUser: template.assignedToUser,
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
      <div className="spread" style={{ flexWrap: "wrap" }}>
        <div>
          <div className="card-title">{template.name}</div>
          <div className="card-meta">
            <span className="badge">
              {template.assignedRole?.name ?? "no role"}
            </span>{" "}
            {TRIGGERS.find((t) => t.value === template.triggerType)?.label ??
              template.triggerType}{" "}
            · {sections.length} section{sections.length === 1 ? "" : "s"} ·{" "}
            {itemCount} item{itemCount === 1 ? "" : "s"}
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn btn-sm btn-quiet" onClick={onToggle}>
            {expanded ? "Done" : "Edit"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => void duplicate()}
          >
            Duplicate
          </button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove()}>
            Delete
          </button>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 12 }}>
          <div className="grid-2">
            <div>
              <div className="field">
                <span className="field-label">Name</span>
                <DraftInput
                  className="input"
                  value={template.name}
                  onCommit={(name) => update({ name })}
                />
              </div>

              <div className="field">
                <span className="field-label">Assigned role — required</span>
                <select
                  className="select select-inline"
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
                {!template.assignedRole && (
                  <p className="small muted" style={{ marginTop: 4 }}>
                    Pick a role — until then these checklists are assigned to
                    whoever triggers them.
                  </p>
                )}
                <label className="row" style={{ cursor: "pointer", marginTop: 6 }}>
                  <input
                    type="checkbox"
                    checked={template.assignedToUser}
                    onChange={(e) => update({ assignedToUser: e.target.checked })}
                  />
                  <span className="small">
                    Assign each checklist to whoever triggers it — otherwise it
                    stays unclaimed for anyone holding the role
                  </span>
                </label>
              </div>

              <div className="field">
                <span className="field-label">
                  Viewer roles — read-only monitoring
                </span>
                <div className="stack" style={{ gap: 2 }}>
                  {roles
                    .filter((r) => r.id !== template.assignedRole?.id)
                    .map((r) => (
                      <label key={r.id} className="row" style={{ cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={viewerRoleIds.has(r.id)}
                          onChange={(e) =>
                            void db.transact(
                              e.target.checked
                                ? db.tx.checklistTemplates[template.id].link({
                                    viewerRoles: r.id,
                                  })
                                : db.tx.checklistTemplates[template.id].unlink({
                                    viewerRoles: r.id,
                                  }),
                            )
                          }
                        />
                        <span className="small">{r.name}</span>
                      </label>
                    ))}
                  {roles.length <= 1 && (
                    <span className="muted small">No other roles exist.</span>
                  )}
                </div>
              </div>

              <div className="field">
                <span className="field-label">Trigger</span>
                <select
                  className="select select-inline"
                  value={template.triggerType}
                  onChange={(e) => update({ triggerType: e.target.value })}
                >
                  {TRIGGERS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
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
                nounPhrase="checklist"
              />
            </div>

            <div>
              <div className="section-title">Sections</div>
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
                    locations={locations}
                    allCheckpoints={allCheckpoints}
                    allAssets={allAssets}
                    pathOf={pathOf}
                  />
                )}
              />
              {sections.length === 0 && (
                <span className="muted small">
                  No sections yet — items live inside sections.
                </span>
              )}
              <div style={{ marginTop: 8 }}>
                <button type="button" className="btn btn-sm" onClick={addSection}>
                  + Add section
                </button>
              </div>
              {sections.length > 1 && (
                <p className="muted small" style={{ marginTop: 4 }}>
                  Drag ⠿ to reorder sections.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Sections

function SectionEditor({
  section,
  locations,
  allCheckpoints,
  allAssets,
  pathOf,
}: {
  section: SectionRow & { items: TemplateItemRow[] };
  locations: { id: string; name: string; parent?: { id: string } | null }[];
  allCheckpoints: { id: string; name: string; location?: { id: string; name: string } | null }[];
  allAssets: { id: string; name: string }[];
  pathOf: (locationId: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [addingCheckpoints, setAddingCheckpoints] = useState(false);
  const [addingAssets, setAddingAssets] = useState(false);

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
  const versionItem = (
    item: TemplateItemRow,
    patch: { label?: string; config?: Record<string, unknown> },
  ) => {
    const newId = id();
    void db.transact([
      db.tx.checklistTemplateItems[newId]
        .update({
          type: item.type,
          label: patch.label ?? item.label,
          order: item.order,
          version: (item.version ?? 1) + 1,
          config: patch.config ?? item.config ?? {},
        })
        .link({ section: section.id, previousVersion: item.id }),
      db.tx.checklistTemplateItems[item.id].unlink({ section: section.id }),
    ]);
  };

  // The label starts as the type's own name and is edited inline on the row.
  // A door or lock needs a Location, and the section's own location is
  // almost always the right one — so default it.
  const addItem = (type: ItemType) =>
    void db.transact(
      db.tx.checklistTemplateItems[id()]
        .update({
          type,
          label: ITEM_TYPE_LABEL[type],
          order: items.length,
          version: 1,
          config:
            isStateCheck(type) && section.location
              ? { locationId: section.location.id }
              : {},
        })
        .link({ section: section.id }),
    );

  const duplicateItem = (item: TemplateItemRow) =>
    void db.transact(
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
  const removeItem = (itemId: string) =>
    void db.transact(
      db.tx.checklistTemplateItems[itemId].unlink({ section: section.id }),
    );

  const removeSection = () => {
    if (
      !window.confirm(
        `Delete section "${section.name}"? Checklists already generated keep their copy.`,
      )
    )
      return;
    void db.transact(db.tx.checklistTemplateSections[section.id].delete());
  };

  return (
    <div className="card">
      <div className="spread" style={{ flexWrap: "wrap" }}>
        <span className="row" style={{ minWidth: 0 }}>
          <DraftInput
            className="input select-inline"
            style={{ minWidth: 0 }}
            value={section.name}
            aria-label="Section name"
            onCommit={(name) => update({ name })}
          />
          {!section.isActive && <span className="badge">Inactive</span>}
        </span>
        <span className="row" style={{ gap: 2 }}>
          <span className="muted small">
            {items.length} item{items.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => setOpen(!open)}
          >
            {open ? "Close" : "Open"}
          </button>
          <button type="button" className="btn btn-sm btn-quiet" onClick={removeSection}>
            ✕
          </button>
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 8 }}>
          <label className="row" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={section.isActive}
              onChange={(e) => update({ isActive: e.target.checked })}
            />
            <span className="small">
              Active — inactive sections are never added to new checklists
            </span>
          </label>

          <div className="field" style={{ marginTop: 8 }}>
            <span className="field-label">Section trigger</span>
            <select
              className="select select-inline"
              value={section.triggerType}
              onChange={(e) => update({ triggerType: e.target.value })}
            >
              {SECTION_TRIGGERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
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

          <div className="field">
            <span className="field-label">Location</span>
            <LocationPicker
              locations={locations}
              value={section.location?.id ?? ""}
              onChange={(next) => setLocation(next || undefined)}
              placeholder="Search locations…"
            />
            {section.location && (
              <div style={{ marginTop: 6 }}>
                <span className="small muted">
                  Checkpoints — in {section.location.name} only
                </span>
                <div className="stack" style={{ gap: 2, marginTop: 4 }}>
                  {(section.checkpoints ?? []).map((c) => (
                    <div key={c.id} className="row spread">
                      <span className="small">{c.name}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-quiet"
                        onClick={() =>
                          void db.transact(
                            db.tx.checklistTemplateSections[section.id].unlink({
                              checkpoints: c.id,
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
                  disabled={
                    checkpointChoices.filter((c) => !attachedCheckpointIds.has(c.id))
                      .length === 0
                  }
                  onClick={() => setAddingCheckpoints(true)}
                >
                  + Add checkpoints
                </button>
              </div>
            )}
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

          <RuleFields
            hideUntilRule={section.hideUntilRule}
            dueBy={section.dueBy}
            onHideUntilRule={(hideUntilRule) =>
              update({ hideUntilRule: hideUntilRule || null })
            }
            onDueBy={(dueBy) => update({ dueBy: dueBy ?? null })}
            nounPhrase="section"
          />

          <div className="section-title" style={{ marginTop: 10 }}>
            Items
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
                onEdit={versionItem}
                onDuplicate={duplicateItem}
                onRemove={removeItem}
              />
            )}
          />
          {items.length === 0 && <span className="muted small">No items yet.</span>}
          <select
            className="select select-inline"
            style={{ marginTop: 8 }}
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
          {items.length > 1 && (
            <p className="muted small" style={{ marginTop: 4 }}>
              Drag ⠿ to reorder.
            </p>
          )}
        </div>
      )}

      {addingCheckpoints && (
        <MultiSelectDialog
          title={`Attach checkpoints to ${section.name}`}
          options={checkpointChoices
            .filter((c) => !attachedCheckpointIds.has(c.id))
            .map((c) => ({
              id: c.id,
              name: c.name,
              group: c.location ? pathOf(c.location.id) : "No location",
            }))}
          onConfirm={(ids) => {
            if (ids.length > 0)
              void db.transact(
                db.tx.checklistTemplateSections[section.id].link({ checkpoints: ids }),
              );
          }}
          onClose={() => setAddingCheckpoints(false)}
          confirmLabel="Attach"
          emptyMessage="Every checkpoint in this location is already attached."
        />
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
  nounPhrase,
}: {
  hideUntilRule: string | undefined;
  dueBy: DueByRule | undefined;
  onHideUntilRule: (rule: string) => void;
  onDueBy: (rule: DueByRule | undefined) => void;
  nounPhrase: string;
}) {
  const kind = dueBy?.kind ?? "";
  return (
    <>
      <div className="field">
        <span className="field-label">Hide until — optional</span>
        <div className="row">
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
        <p className="muted small" style={{ marginTop: 4 }}>
          The {nounPhrase} exists from creation but stays hidden until this
          time of day — and once shown, never re-hides.
        </p>
      </div>
      <div className="field">
        <span className="field-label">Due by — optional</span>
        <div className="row">
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
            <option value="offset">Within minutes of creation</option>
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
  onEdit,
  onDuplicate,
  onRemove,
}: {
  item: TemplateItemRow;
  onEdit: (
    item: TemplateItemRow,
    patch: { label?: string; config?: Record<string, unknown> },
  ) => void;
  onDuplicate: (item: TemplateItemRow) => void;
  onRemove: (itemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const cfg = (item.config ?? {}) as Record<string, unknown>;

  const setConfig = (patch: Record<string, unknown>) =>
    onEdit(item, { config: { ...cfg, ...patch } });

  return (
    <div className="card">
      <div className="spread">
        <span className="row" style={{ minWidth: 0 }}>
          <span className="badge">{itemTypeLabel(item.type)}</span>
          <DraftInput
            className="input select-inline"
            style={{ minWidth: 0 }}
            value={item.label}
            aria-label="Item label"
            onCommit={(label) => {
              if (label !== item.label) onEdit(item, { label });
            }}
          />
        </span>
        <span className="row" style={{ gap: 2 }}>
          {item.type !== "simple_check" && (
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setOpen(!open)}
            >
              Config
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            title="Duplicate this item"
            onClick={() => onDuplicate(item)}
          >
            ⧉
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={() => onRemove(item.id)}
          >
            ✕
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
}: {
  kind: StateCheckType;
  cfg: Record<string, unknown>;
  setConfig: (patch: Record<string, unknown>) => void;
}) {
  const spec = STATE_CHECK_KINDS[kind];
  const { data } = db.useQuery({ locations: { parent: {}, type: {} } });
  const locations = useMemo(
    () => [...(data?.locations ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );
  const locationId = (cfg.locationId as string) ?? "";

  const finalStateOnly = Boolean(cfg.finalStateOnly);

  return (
    <div>
      <div className="row">
        <span className="small muted">
          {finalStateOnly ? "Expected final state" : "Expected state"}
        </span>
        <select
          className="select select-inline"
          value={(cfg.expectedState as string) ?? spec.defaultState}
          onChange={(e) => setConfig({ expectedState: e.target.value })}
        >
          {spec.states.map((st) => (
            <option key={st} value={st}>
              {st.charAt(0).toUpperCase() + st.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <label className="row" style={{ cursor: "pointer", marginTop: 8 }}>
        <input
          type="checkbox"
          checked={finalStateOnly}
          onChange={(e) => setConfig({ finalStateOnly: e.target.checked })}
        />
        <span className="small">
          No initial expected state — only ask how this {spec.noun} was left, and
          don't raise an incident over how it was found
        </span>
      </label>
      <div className="field" style={{ marginTop: 8, marginBottom: 0 }}>
        <span className="field-label">
          Location this {spec.noun} belongs to — required
        </span>
        <LocationPicker
          locations={locations}
          value={locationId}
          onChange={(next) => setConfig({ locationId: next || undefined })}
          placeholder="Search locations…"
          allowNone={false}
        />
        {!locationId && (
          <div className="badge badge-warn" style={{ display: "block", marginTop: 6 }}>
            Set a location — without one, an incident raised for this {spec.noun}{" "}
            has nothing to attach to.
          </div>
        )}
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
