import { useMemo, useState } from "react";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { ITEM_TYPE_LABEL, type ItemType } from "../../lib/checklists";
import { AdminHeader } from "./AdminHomePage";

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

  const create = async (visibility: string) => {
    const name = window.prompt("New template name:");
    if (!name?.trim()) return;
    const templateId = id();
    await db.transact(
      db.tx.checklistTemplates[templateId]
        .update({
          name: name.trim(),
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
            expanded={editing === t.id}
            onToggle={() => setEditing(editing === t.id ? null : t.id)}
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

type TemplateRow = {
  id: string;
  name: string;
  visibility: string;
  triggerType: string;
  triggerConfig?: Record<string, unknown>;
  assignmentMode: string;
  role?: { id: string; name: string } | null;
  creator?: { id: string; name: string } | null;
  items?: {
    id: string;
    type: string;
    label: string;
    order: number;
    config?: Record<string, unknown>;
  }[];
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
  expanded,
  onToggle,
}: {
  template: TemplateRow;
  roles: { id: string; name: string }[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const update = (fields: Record<string, unknown>) =>
    void db.transact(db.tx.checklistTemplates[template.id].update(fields));

  const items = [...(template.items ?? [])].sort((a, b) => a.order - b.order);
  const cfg = (template.triggerConfig ?? {}) as {
    timeStart?: string;
    timeEnd?: string;
    schedule?: string;
  };

  const addItem = (type: ItemType) => {
    const label = window.prompt(`Label for the new ${ITEM_TYPE_LABEL[type]}:`);
    if (!label?.trim()) return;
    void db.transact(
      db.tx.checklistTemplateItems[id()]
        .update({
          type,
          label: label.trim(),
          order: items.length,
          config: {},
        })
        .link({ template: template.id }),
    );
  };

  const moveItem = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const reordered = [...items];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    void db.transact(
      reordered.map((it, i) =>
        db.tx.checklistTemplateItems[it.id].update({ order: i }),
      ),
    );
  };

  const removeItem = (itemId: string) =>
    void db.transact(db.tx.checklistTemplateItems[itemId].delete());

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
                <input
                  className="input"
                  value={template.name}
                  onChange={(e) => update({ name: e.target.value })}
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
                    onChange={(e) =>
                      void db.transact(
                        db.tx.checklistTemplates[template.id].link({
                          role: e.target.value,
                        }),
                      )
                    }
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
                  <div className="row" style={{ marginTop: 6 }}>
                    <span className="small muted">Applies between</span>
                    <input
                      type="time"
                      className="input select-inline"
                      value={cfg.timeStart ?? ""}
                      onChange={(e) =>
                        update({ triggerConfig: { ...cfg, timeStart: e.target.value } })
                      }
                    />
                    <span className="small muted">and</span>
                    <input
                      type="time"
                      className="input select-inline"
                      value={cfg.timeEnd ?? ""}
                      onChange={(e) =>
                        update({ triggerConfig: { ...cfg, timeEnd: e.target.value } })
                      }
                    />
                  </div>
                )}
                {template.triggerType === "scheduled" && (
                  <input
                    className="input select-inline"
                    style={{ marginTop: 6 }}
                    placeholder="Schedule expression, e.g. 0 6 * * *"
                    value={cfg.schedule ?? ""}
                    onChange={(e) =>
                      update({ triggerConfig: { ...cfg, schedule: e.target.value } })
                    }
                  />
                )}
                {template.triggerType === "checkpoint" && (
                  <p className="muted small" style={{ marginTop: 4 }}>
                    Attach this template to specific checkpoints from Location
                    Types &amp; Locations.
                  </p>
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
              <div className="stack" style={{ gap: 4 }}>
                {items.map((item, i) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    index={i}
                    total={items.length}
                    onMove={moveItem}
                    onRemove={removeItem}
                  />
                ))}
                {items.length === 0 && (
                  <span className="muted small">No items yet.</span>
                )}
              </div>
              <select
                className="select select-inline"
                style={{ marginTop: 8 }}
                value=""
                onChange={(e) => addItem(e.target.value as ItemType)}
              >
                <option value="">Add an item…</option>
                {(Object.keys(ITEM_TYPE_LABEL) as ItemType[]).map((t) => (
                  <option key={t} value={t}>
                    {ITEM_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item,
  index,
  total,
  onMove,
  onRemove,
}: {
  item: { id: string; type: string; label: string; config?: Record<string, unknown> };
  index: number;
  total: number;
  onMove: (index: number, delta: -1 | 1) => void;
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
        <span className="small">
          <span className="badge">
            {ITEM_TYPE_LABEL[item.type as ItemType] ?? item.type}
          </span>{" "}
          {item.label}
        </span>
        <span className="row" style={{ gap: 2 }}>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            disabled={index === total - 1}
            onClick={() => onMove(index, 1)}
            aria-label="Move down"
          >
            ↓
          </button>
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
            onClick={() => onRemove(item.id)}
          >
            ✕
          </button>
        </span>
      </div>

      {open && (
        <div style={{ marginTop: 8 }}>
          {item.type === "door_check" && (
            <div className="row">
              <span className="small muted">Expected state</span>
              <select
                className="select select-inline"
                value={(cfg.expectedState as string) ?? "locked"}
                onChange={(e) => setConfig({ expectedState: e.target.value })}
              >
                {["open", "closed", "locked", "unlocked"].map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
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

function LocationCheckConfig({
  cfg,
  setConfig,
}: {
  cfg: Record<string, unknown>;
  setConfig: (patch: Record<string, unknown>) => void;
}) {
  const { data } = db.useQuery({ locations: {}, checklistTemplates: {} });
  return (
    <div className="row" style={{ flexWrap: "wrap" }}>
      <select
        className="select select-inline"
        value={(cfg.locationId as string) ?? ""}
        onChange={(e) => setConfig({ locationId: e.target.value })}
      >
        <option value="">Scoped to location…</option>
        {(data?.locations ?? []).map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <select
        className="select select-inline"
        value={(cfg.templateId as string) ?? ""}
        onChange={(e) => setConfig({ templateId: e.target.value })}
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
