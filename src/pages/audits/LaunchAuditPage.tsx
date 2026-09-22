import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import type { AuditKind } from "../../lib/auditRules";
import {
  launchAudit,
  rowsToDraft,
  saveTemplateTree,
  useAuditTemplates,
  useTemplateQuestions,
  useTemplateRules,
  type DraftRule,
} from "../../data/audits";
import { useRoles, useUsers } from "../../data/users";
import { RuleTreeEditor, useEditorContext, useResolution } from "./RuleTreeEditor";

// Launch an audit (docs/audits.md § Launching). The template's tree is shown
// for inspection and edits; edits are copied onto the audit, and reach the
// template only through "save back". The rules resolve NOW into the fixed
// target list; a location added afterwards is not in this audit.
export function LaunchAuditPage() {
  const current = useCurrent();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const templateId = params.get("template") ?? "";
  const { data: templates } = useAuditTemplates();
  const template = templates.find((t) => t.id === templateId) ?? null;
  const { data: ruleRows } = useTemplateRules(template?.id);
  const { data: questionRows } = useTemplateQuestions(template?.id);
  const stored = useMemo(() => rowsToDraft(ruleRows, questionRows), [ruleRows, questionRows]);

  const [kind, setKind] = useState<AuditKind>("occupancy");
  const [name, setName] = useState("");
  const [roots, setRoots] = useState<DraftRule[]>([]);
  const [edited, setEdited] = useState(false);
  const [userIds, setUserIds] = useState<string[]>([]);
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A chosen template seeds the draft once; the manager's edits then win.
  useEffect(() => {
    if (!template || edited) return;
    setRoots(stored);
    setKind(template.kind);
    setName(`${template.name} — ${new Date().toLocaleDateString()}`);
  }, [template, stored, edited]);

  const ctx = useEditorContext(kind, roots);
  const res = useResolution(roots, ctx);
  const { data: users } = useUsers();
  const { roles } = useRoles();

  if (!current.can("manage_audits")) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
        <Link to="/audits">← Audits</Link>
      </div>
    );
  }

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const canLaunch = name.trim() && res.targets.length > 0 && (userIds.length || roleIds.length) && !launching;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Launch audit</h1>
          <div className="page-sub">
            <Link to="/audits">← Audits</Link>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
          <div className="field" style={{ minWidth: 220 }}>
            <span className="field-label">Template</span>
            <select
              className="select"
              value={templateId}
              onChange={(e) => {
                setEdited(false);
                setParams(e.target.value ? { template: e.target.value } : {}, { replace: true });
              }}
            >
              <option value="">Blank</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.kind})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span className="field-label">Kind</span>
            <select className="select" value={kind} disabled={!!template} onChange={(e) => setKind(e.target.value as AuditKind)}>
              <option value="occupancy">Occupancy</option>
              <option value="status">Status</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <span className="field-label">Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. B Dock occupancy, September" />
          </div>
        </div>
        <div className="field" style={{ marginTop: 10 }}>
          <span className="field-label">Assign to</span>
          <div className="chip-row" style={{ marginBottom: 4 }}>
            {roles.map((r) => (
              <button key={r.id} type="button" className={`chip ${roleIds.includes(r.id) ? "tree-match" : ""}`} onClick={() => toggle(roleIds, setRoleIds, r.id)}>
                {r.name} (role)
              </button>
            ))}
            {users.map((u) => (
              <button key={u.id} type="button" className={`chip ${userIds.includes(u.id) ? "tree-match" : ""}`} onClick={() => toggle(userIds, setUserIds, u.id)}>
                {u.name}
              </button>
            ))}
          </div>
          <span className="muted small">Any assignee may record any target; a location is done once.</span>
        </div>
      </div>

      <div className="section-title">Rules — {res.targets.length} target locations</div>
      <RuleTreeEditor
        roots={roots}
        onChange={(next) => {
          setRoots(next);
          setEdited(true);
        }}
        ctx={ctx}
        res={res}
      />

      <div className="row" style={{ marginTop: 16, gap: 8, alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canLaunch}
          onClick={async () => {
            setLaunching(true);
            setError(null);
            try {
              const auditId = await launchAudit(
                { name: name.trim(), kind, templateId: template?.id ?? null, roots, targets: res.targets, userIds, roleIds },
                current.user?.id ?? null,
              );
              navigate(`/audits/${auditId}`, { replace: true });
            } catch (e) {
              setError((e as { message?: string }).message ?? String(e));
              setLaunching(false);
            }
          }}
        >
          Launch over {res.targets.length} locations
        </button>
        {template && edited && (
          <button type="button" className="btn btn-sm" onClick={() => void saveTemplateTree(template.id, roots)}>
            Save rules back to template
          </button>
        )}
        {error && <span className="badge badge-bad">{error}</span>}
      </div>
    </div>
  );
}
