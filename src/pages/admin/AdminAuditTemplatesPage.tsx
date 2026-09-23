import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  createAuditTemplate,
  deleteAuditTemplate,
  rowsToDraft,
  saveAuditTemplate,
  saveTemplateTree,
  useAuditTemplate,
  useAuditTemplates,
  useTemplateQuestions,
  useTemplateRules,
  type DraftRule,
} from "../../data/audits";
import type { AuditKind } from "../../lib/auditRules";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { AdminGate } from "./AdminGate";
import { AdminHeader } from "./AdminHomePage";
import { DraftInput } from "../shared/DraftInput";
import { CategoryCheckboxes } from "../audits/CategoryCheckboxes";
import { RuleTreeEditor, useEditorContext, useResolution } from "../audits/RuleTreeEditor";

// Admin — Audit Templates (docs/audits.md § Audit Templates). A template is
// a name, a kind chosen once, and a rule tree with questions on its nodes.
// Launching copies it; editing here never reaches a launched audit.
export function AdminAuditTemplatesPage() {
  return (
    <AdminGate requires="manage_audits">
      <Templates />
    </AdminGate>
  );
}

function Templates() {
  const { id } = useParams();
  if (id) return <TemplateEditor templateId={id} />;
  return <TemplateList />;
}

function TemplateList() {
  const current = useCurrent();
  const navigate = useNavigate();
  const { data: templates } = useAuditTemplates();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AuditKind>("occupancy");
  return (
    <div>
      <AdminHeader title="Audit Templates" />
      <div className="row" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="New template name" value={name} onChange={(e) => setName(e.target.value)} />
        <select className="select select-inline" value={kind} onChange={(e) => setKind(e.target.value as AuditKind)}>
          <option value="occupancy">Occupancy</option>
          <option value="status">Status</option>
        </select>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={!name.trim()}
          onClick={async () => {
            const templateId = await createAuditTemplate({ name: name.trim(), kind }, current.user?.id ?? null);
            navigate(`/admin/audit-templates/${templateId}`);
          }}
        >
          Create
        </button>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {templates.map((t) => (
          <Link key={t.id} to={`/admin/audit-templates/${t.id}`} className="card" style={{ display: "block" }}>
            <div className="card-title">{t.name}</div>
            <div className="card-meta">{t.kind === "occupancy" ? "Occupancy audit" : "Status audit"}</div>
          </Link>
        ))}
        {templates.length === 0 && <p className="muted small">No templates yet. An Occupancy template asks who is where; a Status template asks what each location provides.</p>}
      </div>
    </div>
  );
}

function TemplateEditor({ templateId }: { templateId: string }) {
  const navigate = useNavigate();
  const { template, isLoading } = useAuditTemplate(templateId);
  const { data: ruleRows } = useTemplateRules(templateId);
  const { data: questionRows } = useTemplateQuestions(templateId);
  const stored = useMemo(() => rowsToDraft(ruleRows, questionRows), [ruleRows, questionRows]);
  // Edits are local until Save: a half-typed condition should not sync to
  // every device as a template change.
  const [roots, setRoots] = useState<DraftRule[] | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setRoots(stored);
  }, [stored, dirty]);
  const tree = roots ?? stored;
  const ctx = useEditorContext(template?.kind ?? "occupancy", tree);
  const res = useResolution(tree, ctx);

  if (isLoading || !template) {
    return (
      <div className="placeholder">
        <div className="big">{isLoading ? "Loading…" : "Template not found"}</div>
      </div>
    );
  }
  return (
    <div>
      <div className="page-head">
        <div>
          <DraftInput className="input" style={{ fontSize: "1.2rem", fontWeight: 650, maxWidth: 360 }} value={template.name} onCommit={(name) => void saveAuditTemplate(templateId, { name })} />
          <div className="page-sub">
            <Link to="/admin/audit-templates">← Audit Templates</Link> · {template.kind === "occupancy" ? "Occupancy" : "Status"} audit
          </div>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-sm btn-quiet"
            onClick={async () => {
              if (!window.confirm(`Delete template "${template.name}"? Launched audits keep their own copy.`)) return;
              await deleteAuditTemplate(templateId);
              navigate("/admin/audit-templates");
            }}
          >
            Delete
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!dirty}
            onClick={async () => {
              await saveTemplateTree(templateId, tree);
              setDirty(false);
            }}
          >
            {dirty ? "Save rules" : "Saved"}
          </button>
        </div>
      </div>
      {template.kind === "status" && (
        <div className="field" style={{ marginBottom: 16 }}>
          <span className="field-label">Ask about</span>
          <CategoryCheckboxes
            flags={template}
            onChange={(flags) => void saveAuditTemplate(templateId, flags)}
          />
        </div>
      )}
      <RuleTreeEditor
        roots={tree}
        onChange={(next) => {
          setRoots(next);
          setDirty(true);
        }}
        ctx={ctx}
        res={res}
      />
    </div>
  );
}
