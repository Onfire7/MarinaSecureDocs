import { useMemo, useState } from "react";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import {
  ITEM_TYPE_LABEL,
  STATE_CHECK_KINDS,
  isStateCheck,
  itemTypeLabel,
  normalizeItemType,
  type ItemType,
  type StateCheckType,
} from "../../lib/checklists";
import { LocationPicker } from "../shared/LocationPicker";
import { MultiSelectDialog } from "../shared/MultiSelectDialog";
import { ReorderableList } from "../shared/ReorderableList";
import { AdminHeader } from "./AdminHomePage";
import { DraftInput } from "../shared/DraftInput";
import { groupByLocation, locationPathResolver } from "../../lib/checkpoints";

// Admin — Checklist Templates (see docs/pages/admin-checklist-templates.html).
// manage_checklists governs Global and Role-restricted templates. Personal
// templates are a deliberate carve-out: always editable by their creator
// regardless of that permission, and never editable by anyone else — so this
// page is reachable without manage_checklists, showing only one's own.
export function AdminChecklistTemplatesPage() {
  const current = useCurrent();
  const canManage = current.can("manage_checklists");
  const [editing, setEditing] = useState<string | null>(null);

  const { data } = db.useQuery({
    checklistTemplates: { items: {}, role: {}, creator: {}, checkpoints: {} },
    roles: {},
    checkpoints: { location: {} },
    locations: { parent: {} },
  });

  const templates = useMemo(() => {
    const all = data?.checklistTemplates ?? [];
    return all
      .filter((t) =>
        t.visibility === "personal"
          ? t.creator?.id === current.user?.id
          : canManage,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, canManage, current.user]);

  const roles = data?.roles ?? [];
  const pathOf = useMemo(
    () => locationPathResolver(data?.locations ?? []),
    [data],
  );
  const allCheckpoints = useMemo(
    () =>
      [...(data?.checkpoints ?? [])].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true }),
      ),
    [data],
  );

  // Created with a placeholder name and opened straight into the editor,
  // where the name field already lives — a prompt first would just be a
  // modal asking for something the next screen also asks for.
  const create = async (visibility: string) => {
    const templateId = id();
    await db.transact(
      db.tx.checklistTemplates[templateId]
        .update({
          name: visibility === "personal" ? "New personal template" : "New template",
          visibility,
          triggerType: "manual",
          assignmentMode: "triggering_user",
        })
        .link(current.user ? { creator: current.user.id } : {}),
    );
    setEditing(templateId);
  };

  return (
    <div>
      <AdminHeader title="Checklist Templates">
        <div className="row">
          {canManage && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => void create("global")}
            >
              + New template
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void create("personal")}
          >
            + Personal
          </button>
        </div>
      </AdminHeader>

      {!canManage && (
        <p className="muted small" style={{ marginBottom: 12 }}>
          Showing only your own personal templates — managing global and
          role-restricted ones needs <code>manage_checklists</code>.
        </p>
      )}

      <div className="stack" style={{ gap: 8 }}>
        {templates.map((t) => (
          <TemplateCard
            key={t.id}
            template={t}
            roles={roles}
            allCheckpoints={allCheckpoints}
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
  config?: Record<string, unknown>;
};

type TemplateRow = {
  id: string;
  name: string;
  visibility: string;
  triggerType: string;
  triggerConfig?: Record<string, unknown>;
  assignmentMode: string;
  role?: { id: string; name: string } | null;
  creator?: { id: string; name: string } | null;
  checkpoints?: { id: string; name: string }[];
  items?: TemplateItemRow[];
};

const TRIGGERS = [
  { value: "manual", label: "Manual" },
  { value: "clock_in", label: "Clock In" },
  { value: "clock_out", label: "Clock Out" },
  { value: "scheduled", label: "Scheduled time" },
  { value: "checkpoint", label: "Checkpoint visit" },
  { value: "incident_type", label: "Incident type" },
];

function TemplateCard({
  template,
  roles,
  allCheckpoints,
  pathOf,
  expanded,
  onToggle,
  onDuplicated,
}: {
  template: TemplateRow;
  roles: { id: string; name: string }[];
  allCheckpoints: { id: string; name: string; location?: { id: string; name: string } | null }[];
  pathOf: (locationId: string) => string;
  expanded: boolean;
  onToggle: () => void;
  onDuplicated: (templateId: string) => void;
}) {
  const [addingCheckpoints, setAddingCheckpoints] = useState(false);
  const update = (fields: Record<string, unknown>) =>
    void db.transact(db.tx.checklistTemplates[template.id].update(fields));

  // Memoized because `?? []` mints a new array each render, which would
  // rebuild the grouping below every time.
  const checkpointMembers = useMemo(
    () => template.checkpoints ?? [],
    [template.checkpoints],
  );
  const checkpointMemberIds = new Set(checkpointMembers.map((c) => c.id));
  // template.checkpoints carries no location, so resolve each against the
  // full list before grouping.
  const attachedGroups = useMemo(
    () =>
      groupByLocation(
        checkpointMembers.map(
          (m) => allCheckpoints.find((c) => c.id === m.id) ?? { ...m, location: null },
        ),
        pathOf,
      ),
    [checkpointMembers, allCheckpoints, pathOf],
  );
  const addCheckpoints = (ids: string[]) => {
    if (ids.length === 0) return;
    void db.transact(
      db.tx.checklistTemplates[template.id].link({ checkpoints: ids }),
    );
  };
  const removeCheckpoint = (checkpointId: string) =>
    void db.transact(
      db.tx.checklistTemplates[template.id].unlink({ checkpoints: checkpointId }),
    );

  const items = useMemo(
    () => [...(template.items ?? [])].sort((a, b) => a.order - b.order),
    [template.items],
  );
  const cfg = (template.triggerConfig ?? {}) as {
    timeStart?: string;
    timeEnd?: string;
    schedule?: string;
  };

  // The label starts as the type's own name and is edited inline on the row.
  // Prompting for it first meant a modal per item, on a screen where twelve
  // items is a normal template.
  const addItem = (type: ItemType) => {
    // A door or pump needs a Location, and on a checkpoint-triggered template
    // the checkpoint's own location is almost always the right one — so
    // default it rather than making the admin set it item by item. Ambiguous
    // when several checkpoints are attached, so only default from a single
    // one and leave the rest to the picker.
    const attached = template.checkpoints ?? [];
    const soleLocationId =
      isStateCheck(type) && attached.length === 1
        ? (allCheckpoints.find((c) => c.id === attached[0].id)?.location?.id ?? undefined)
        : undefined;
    void db.transact(
      db.tx.checklistTemplateItems[id()]
        .update({
          type,
          label: ITEM_TYPE_LABEL[type],
          order: items.length,
          config: soleLocationId ? { locationId: soleLocationId } : {},
        })
        .link({ template: template.id }),
    );
  };

  const duplicateItem = (item: TemplateItemRow) => {
    void db.transact(
      db.tx.checklistTemplateItems[id()]
        .update({
          type: item.type,
          label: `${item.label} (copy)`,
          order: items.length,
          config: item.config ?? {},
        })
        .link({ template: template.id }),
    );
  };

  const removeItem = (itemId: string) =>
    void db.transact(db.tx.checklistTemplateItems[itemId].delete());

  const duplicate = async () => {
    const copyId = id();
    await db.transact([
      db.tx.checklistTemplates[copyId]
        .update({
          name: `${template.name} (copy)`,
          visibility: template.visibility,
          triggerType: template.triggerType,
          triggerConfig: template.triggerConfig ?? {},
          assignmentMode: template.assignmentMode,
        })
        .link({
          ...(template.role ? { role: template.role.id } : {}),
          ...(template.creator ? { creator: template.creator.id } : {}),
          ...(checkpointMembers.length > 0
            ? { checkpoints: checkpointMembers.map((c) => c.id) }
            : {}),
        }),
      // Items are their own entities, so a copy needs its own set rather
      // than links to the originals' — editing the copy must not touch the
      // template it came from.
      ...items.map((it, i) =>
        db.tx.checklistTemplateItems[id()]
          .update({
            type: it.type,
            label: it.label,
            order: i,
            config: it.config ?? {},
          })
          .link({ template: copyId }),
      ),
    ]);
    onDuplicated(copyId);
  };

  const remove = async () => {
    // In-progress instances keep their own data; only future triggers stop.
    if (
      !window.confirm(
        `Delete "${template.name}"? Checklists already generated from it are unaffected.`,
      )
    )
      return;
    await db.transact(db.tx.checklistTemplates[template.id].delete());
  };

  return (
    <div className="card">
      <div className="spread" style={{ flexWrap: "wrap" }}>
        <div>
          <div className="card-title">{template.name}</div>
          <div className="card-meta">
            <span className="badge">{template.visibility.replace("_", "-")}</span>{" "}
            {TRIGGERS.find((t) => t.value === template.triggerType)?.label ??
              template.triggerType}{" "}
            · {items.length} item{items.length === 1 ? "" : "s"}
            {template.visibility === "personal" && template.creator && (
              <span className="muted"> · {template.creator.name}'s</span>
            )}
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
                <span className="field-label">Visibility</span>
                <select
                  className="select select-inline"
                  value={template.visibility}
                  onChange={(e) => update({ visibility: e.target.value })}
                >
                  <option value="global">Global</option>
                  <option value="role_restricted">Role-restricted</option>
                  <option value="personal">Personal</option>
                </select>
                {template.visibility === "role_restricted" && (
                  <select
                    className="select select-inline"
                    style={{ marginLeft: 6 }}
                    value={template.role?.id ?? ""}
                    onChange={(e) => {
                      // The placeholder option carries no id — linking it
                      // would write an empty ref.
                      if (!e.target.value) return;
                      void db.transact(
                        db.tx.checklistTemplates[template.id].link({
                          role: e.target.value,
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
                )}
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

                {template.triggerType === "checkpoint" && (
                  <div style={{ marginTop: 6 }}>
                    <div className="row">
                      <span className="small muted">Applies between</span>
                      <DraftInput
                        type="time"
                        className="input select-inline"
                        aria-label="Start of window"
                        value={cfg.timeStart ?? ""}
                        onCommit={(timeStart) =>
                          update({ triggerConfig: { ...cfg, timeStart } })
                        }
                      />
                      {cfg.timeStart && (
                        <button
                          type="button"
                          className="btn btn-sm btn-quiet"
                          onClick={() => {
                            const { timeStart: _drop, ...rest } = cfg;
                            update({ triggerConfig: rest });
                          }}
                        >
                          Clear
                        </button>
                      )}
                      <span className="small muted">and</span>
                      <DraftInput
                        type="time"
                        className="input select-inline"
                        aria-label="End of window"
                        value={cfg.timeEnd ?? ""}
                        onCommit={(timeEnd) =>
                          update({ triggerConfig: { ...cfg, timeEnd } })
                        }
                      />
                      {cfg.timeEnd && (
                        <button
                          type="button"
                          className="btn btn-sm btn-quiet"
                          onClick={() => {
                            const { timeEnd: _drop, ...rest } = cfg;
                            update({ triggerConfig: rest });
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <p className="muted small" style={{ marginTop: 4 }}>
                      Leave both empty to apply at any time. An end time
                      earlier than the start wraps past midnight (e.g. 5:00
                      PM–5:00 AM applies overnight).
                    </p>
                  </div>
                )}
                {template.triggerType === "scheduled" && (
                  <DraftInput
                    className="input select-inline"
                    style={{ marginTop: 6 }}
                    placeholder="Schedule expression, e.g. 0 6 * * *"
                    aria-label="Schedule expression"
                    value={cfg.schedule ?? ""}
                    onCommit={(schedule) =>
                      update({ triggerConfig: { ...cfg, schedule } })
                    }
                  />
                )}
                {template.triggerType === "checkpoint" && (
                  <div style={{ marginTop: 6 }}>
                    <span className="small muted">Checkpoints</span>
                    <div className="stack" style={{ gap: 4, marginTop: 4 }}>
                      {attachedGroups.map((g) => (
                        <div key={g.locationId || "none"}>
                          <div className="group-heading">
                            <span>{g.label}</span>
                          </div>
                          {g.items.map((c) => (
                            <div key={c.id} className="row spread">
                              <span className="small">{c.name}</span>
                              <button
                                type="button"
                                className="btn btn-sm btn-quiet"
                                onClick={() => removeCheckpoint(c.id)}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>
                      ))}
                      {checkpointMembers.length === 0 && (
                        <span className="muted small">
                          Not attached to any checkpoint yet — this template
                          never triggers until it is.
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{ marginTop: 6 }}
                      disabled={allCheckpoints.length === checkpointMemberIds.size}
                      onClick={() => setAddingCheckpoints(true)}
                    >
                      + Add checkpoints
                    </button>
                  </div>
                )}
                {template.triggerType === "scheduled" && (
                  <p className="muted small" style={{ marginTop: 4 }}>
                    Evaluated by the scheduled-trigger function; this screen
                    only authors the expression.
                  </p>
                )}
              </div>

              <div className="field">
                <span className="field-label">Assignment</span>
                <select
                  className="select select-inline"
                  value={template.assignmentMode}
                  onChange={(e) => update({ assignmentMode: e.target.value })}
                >
                  <option value="triggering_user">To the triggering user</option>
                  <option value="role">To a role</option>
                </select>
              </div>
            </div>

            <div>
              <div className="section-title">Items</div>
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
          </div>
        </div>
      )}

      {addingCheckpoints && (
        <MultiSelectDialog
          title={`Attach ${template.name} to checkpoints`}
          options={allCheckpoints
            .filter((c) => !checkpointMemberIds.has(c.id))
            .map((c) => ({
              id: c.id,
              name: c.name,
              group: c.location ? pathOf(c.location.id) : "No location",
            }))}
          onConfirm={addCheckpoints}
          onClose={() => setAddingCheckpoints(false)}
          confirmLabel="Attach"
          emptyMessage="Already attached to every checkpoint."
        />
      )}
    </div>
  );
}

function ItemRow({
  item,
  onDuplicate,
  onRemove,
}: {
  item: TemplateItemRow;
  onDuplicate: (item: TemplateItemRow) => void;
  onRemove: (itemId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const cfg = (item.config ?? {}) as Record<string, unknown>;

  const setConfig = (patch: Record<string, unknown>) =>
    void db.transact(
      db.tx.checklistTemplateItems[item.id].update({ config: { ...cfg, ...patch } }),
    );

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
            onCommit={(label) =>
              void db.transact(
                db.tx.checklistTemplateItems[item.id].update({ label }),
              )
            }
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
