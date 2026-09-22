import { useState } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useAudits, type AuditRow, type AuditStatus } from "../../data/audits";
import { AuditsSection } from "./AuditsSection";

// Audits — the section (docs/audits.md § Where an Audit appears, 3). Field
// work first: the targets assigned to this user, then every audit for those
// who launch and finalize them.
export function AuditsHomePage() {
  const current = useCurrent();
  const { data: audits } = useAudits();
  const [tab, setTab] = useState<AuditStatus>("open");
  const canManage = current.can("manage_audits");
  const shown = audits.filter((a) => a.status === tab);
  return (
    <div>
      <div className="page-head">
        <h1 className="page-title">Audits</h1>
        {canManage && (
          <Link to="/audits/new" className="btn btn-sm btn-primary">
            Launch audit
          </Link>
        )}
      </div>

      <AuditsSection full />

      <div className="section-title" style={{ marginTop: 20 }}>
        All audits
      </div>
      <div className="chip-row">
        {(["open", "closed", "finalized"] as AuditStatus[]).map((s) => (
          <button key={s} type="button" className={`chip ${tab === s ? "tree-match" : ""}`} onClick={() => setTab(s)}>
            {s[0].toUpperCase() + s.slice(1)} · {audits.filter((a) => a.status === s).length}
          </button>
        ))}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {shown.map((a) => (
          <AuditCard key={a.id} audit={a} />
        ))}
        {shown.length === 0 && <p className="muted small">No {tab} audits.</p>}
      </div>
    </div>
  );
}

export function AuditCard({ audit }: { audit: AuditRow }) {
  const pct = audit.target_count ? Math.round((audit.audited_count / audit.target_count) * 100) : 0;
  return (
    <Link to={`/audits/${audit.id}`} className="card" style={{ display: "block" }}>
      <div className="card-kicker">
        <span>{audit.kind === "occupancy" ? "Occupancy" : "Status"} · {audit.status}</span>
        <span>{new Date(audit.launched_at).toLocaleDateString()}</span>
      </div>
      <div className="card-title">{audit.name}</div>
      <div className="card-meta">
        {audit.audited_count} of {audit.target_count} audited ({pct}%)
        {audit.not_audited_count > 0 && ` · ${audit.not_audited_count} not audited`}
        {audit.status === "closed" && audit.undecided_count > 0 && ` · ${audit.undecided_count} proposals to decide`}
      </div>
    </Link>
  );
}
