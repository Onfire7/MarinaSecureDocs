import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import {
  closeAudit,
  decideProposal,
  finalizeAudit,
  parseProposalPayload,
  useAudit,
  useAuditProposals,
  useAuditTargets,
  type AuditProposalRow,
  type AuditTargetRow,
} from "../../data/audits";
import { useLocationTypes, useLocations } from "../../data/locations";
import { useAmenities, useAttributes, useServices } from "../../data/services";

// An audit: progress and its targets while open, the finalize screen once
// closed (docs/audits.md § Closing, § Finalizing). Decisions save one at a
// time; Finalize enables when every proposal has one.
export function AuditDetailPage() {
  const { id } = useParams();
  const current = useCurrent();
  const { audit, isLoading } = useAudit(id);
  const { data: targets } = useAuditTargets(id);
  const { data: proposals } = useAuditProposals(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "audited" | "not_audited">("all");

  if (isLoading || !audit) {
    return (
      <div className="placeholder">
        <div className="big">{isLoading ? "Loading…" : "Audit not found"}</div>
        <Link to="/audits">← Audits</Link>
      </div>
    );
  }
  const canManage = current.can("manage_audits");
  const canStructural = current.can("manage_locations");
  const undecided = proposals.filter((p) => p.decision === null);
  const structuralApproved = proposals.some((p) => p.structural === 1 && p.decision === "approved");
  const canFinalize = audit.status === "closed" && canManage && undecided.length === 0 && (!structuralApproved || canStructural);
  const unexpected = targets.filter((t) => t.finding_id).length; // refined below per finding

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as { message?: string }).message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const shownTargets = targets.filter((t) => filter === "all" || t.state === filter);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{audit.name}</h1>
          <div className="page-sub">
            <Link to="/audits">← Audits</Link> · {audit.kind === "occupancy" ? "Occupancy" : "Status"} · {audit.status}
          </div>
        </div>
        <div className="row">
          {audit.status === "open" && canManage && (
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => window.confirm("Close this audit early? Remaining locations are marked Not Audited.") && void run(() => closeAudit(audit.id))}>
              Close early
            </button>
          )}
          {audit.status === "closed" && canManage && (
            <button type="button" className="btn btn-sm btn-primary" disabled={!canFinalize || busy} title={!canFinalize ? (undecided.length ? "Every proposal needs a decision" : "Structural proposals need manage_locations") : undefined} onClick={() => void run(() => finalizeAudit(audit.id))}>
              Finalize
            </button>
          )}
        </div>
      </div>
      {error && <div className="badge badge-bad" style={{ marginBottom: 10 }}>{error}</div>}

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="card-kicker">
          <span>Summary</span>
        </div>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <span><b>{audit.target_count}</b> targets</span>
          <span><b>{audit.audited_count}</b> audited</span>
          <span><b>{audit.not_audited_count}</b> not audited</span>
          <span><b>{proposals.length}</b> proposals{undecided.length > 0 && `, ${undecided.length} undecided`}</span>
          <span className="muted small">{unexpected ? "" : ""}</span>
        </div>
      </div>

      {audit.status !== "open" && (
        <ProposalsTable
          proposals={proposals}
          canManage={canManage}
          canStructural={canStructural}
          decided={audit.status === "finalized"}
          actorId={current.user?.id ?? null}
        />
      )}

      <div className="section-title">Locations</div>
      <div className="chip-row">
        {(["all", "pending", "audited", "not_audited"] as const).map((f) => (
          <button key={f} type="button" className={`chip ${filter === f ? "tree-match" : ""}`} onClick={() => setFilter(f)}>
            {f.replace("_", " ")}
          </button>
        ))}
        {audit.status === "open" && (
          <Link to={`/audits/${audit.id}/propose`} className="btn btn-sm">
            + propose a new location
          </Link>
        )}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {shownTargets.map((t) => (
          <TargetRow key={t.id} audit={audit.id} target={t} open={audit.status === "open"} />
        ))}
      </div>
    </div>
  );
}

function TargetRow({ audit, target, open }: { audit: string; target: AuditTargetRow; open: boolean }) {
  const body = (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <span>
        <b>{target.location_name}</b> <span className="muted small">{target.type_name ?? ""}{target.status_name ? ` · ${target.status_name}` : ""}</span>
        {target.displaced_note && <span className="badge badge-warn" style={{ marginLeft: 6 }}>{target.displaced_note}</span>}
      </span>
      <span className={`badge ${target.state === "audited" ? "badge-good" : target.state === "not_audited" ? "badge-bad" : ""}`}>
        {target.state === "not_audited" ? `not audited · ${target.not_audited_reason ?? ""}` : target.state}
      </span>
    </div>
  );
  const style = { display: "block", border: "1px solid var(--line-lt)", borderRadius: 8 } as const;
  return open || target.finding_id ? (
    <Link to={`/audits/${audit}/targets/${target.id}`} className="tree-row" style={style}>
      {body}
    </Link>
  ) : (
    <div className="tree-row" style={style}>{body}</div>
  );
}

const KIND_LABEL: Record<AuditProposalRow["kind"], string> = {
  create_location: "New location",
  retire_location: "Retire",
  rename: "Rename",
  retype: "Change type",
  reparent: "Move under",
  move_placement: "Move on map",
  set_gps: "GPS",
  set_service: "Service",
  set_amenity: "Amenity",
  set_attribute: "Attribute",
};

function ProposalsTable({
  proposals,
  canManage,
  canStructural,
  decided,
  actorId,
}: {
  proposals: AuditProposalRow[];
  canManage: boolean;
  canStructural: boolean;
  decided: boolean;
  actorId: string | null;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const { data: services } = useServices();
  const { data: amenities } = useAmenities();
  const { data: attributes } = useAttributes();
  const { data: types } = useLocationTypes();
  const { data: locations } = useLocations();
  const nameOf = (list: { id: string; name: string }[], id: unknown) => list.find((x) => x.id === id)?.name ?? "?";

  const describe = (p: AuditProposalRow) => {
    const pl = parseProposalPayload(p);
    switch (p.kind) {
      case "create_location":
        return `${pl.name} (${nameOf(types, pl.location_type_id)}${pl.parent_id ? ` under ${nameOf(locations, pl.parent_id)}` : ""})`;
      case "rename":
        return `→ ${pl.name}`;
      case "retype":
        return `→ ${nameOf(types, pl.location_type_id)}`;
      case "reparent":
        return `→ ${nameOf(locations, pl.parent_id)}`;
      case "set_gps":
        return `${Number(pl.lat).toFixed(5)}, ${Number(pl.lng).toFixed(5)} (±${pl.accuracy ?? "?"} m)`;
      case "set_service":
        return `${nameOf(services, pl.service_id)} ${pl.present ? "present" : "absent"}`;
      case "set_amenity":
        return `${nameOf(amenities, pl.amenity_id)} ${pl.present ? "present" : "absent"}`;
      case "set_attribute": {
        const attr = attributes.find((x) => x.id === pl.attribute_id);
        return pl.present
          ? `${attr?.name ?? "?"} → ${pl.value}${attr?.unit ? ` ${attr.unit}` : ""}`
          : `${attr?.name ?? "?"} removed`;
      }
      default:
        return "";
    }
  };
  const mayDecide = (p: AuditProposalRow) => !decided && canManage && (p.structural === 0 || canStructural);
  const decideChecked = async (decision: "approved" | "rejected") => {
    for (const p of proposals) {
      if (!checked.has(p.id) || !mayDecide(p)) continue;
      if (decision === "rejected" && !(reasons[p.id] ?? "").trim()) continue;
      await decideProposal(p.id, decision, reasons[p.id] ?? null, actorId);
    }
    setChecked(new Set());
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="card-kicker">
        <span>Proposals · {proposals.length}</span>
        {!decided && canManage && (
          <span className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm" disabled={checked.size === 0} onClick={() => void decideChecked("approved")}>
              Approve checked
            </button>
            <button type="button" className="btn btn-sm btn-danger" disabled={checked.size === 0} onClick={() => void decideChecked("rejected")}>
              Reject checked
            </button>
          </span>
        )}
      </div>
      {proposals.length === 0 && <div className="muted small">No proposals. Nothing structural changed.</div>}
      {proposals.map((p) => {
        const allowed = mayDecide(p);
        return (
          <div key={p.id} className="row" style={{ padding: "6px 0", borderBottom: "1px solid var(--line-lt)", gap: 8, alignItems: "center", flexWrap: "wrap", opacity: allowed || decided ? 1 : 0.55 }}>
            {!decided && (
              <input
                type="checkbox"
                aria-label="select proposal"
                disabled={!allowed}
                checked={checked.has(p.id)}
                onChange={(e) => {
                  const next = new Set(checked);
                  if (e.target.checked) next.add(p.id);
                  else next.delete(p.id);
                  setChecked(next);
                }}
              />
            )}
            <span className={`badge ${p.structural ? "badge-warn" : ""}`}>{KIND_LABEL[p.kind]}</span>
            <span style={{ flex: 1, minWidth: 160 }}>
              <b>{p.location_name ?? "-"}</b> <span className="muted small">{describe(p)}</span>
              <span className="muted small"> · {p.recorded_by_name ?? ""}</span>
            </span>
            {p.decision ? (
              <span className={`badge ${p.decision === "approved" ? "badge-good" : "badge-bad"}`}>
                {p.decision}
                {p.reason ? ` - ${p.reason}` : ""}
              </span>
            ) : (
              <>
                <input
                  className="input"
                  style={{ maxWidth: 200 }}
                  placeholder="Reason (needed to reject)"
                  value={reasons[p.id] ?? ""}
                  disabled={!allowed}
                  onChange={(e) => setReasons({ ...reasons, [p.id]: e.target.value })}
                />
                <button type="button" className="btn btn-sm" disabled={!allowed} onClick={() => void decideProposal(p.id, "approved", null, actorId)}>
                  Approve
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  disabled={!allowed || !(reasons[p.id] ?? "").trim()}
                  onClick={() => void decideProposal(p.id, "rejected", reasons[p.id], actorId)}
                >
                  Reject
                </button>
              </>
            )}
            {p.decision && !decided && allowed && (
              <button type="button" className="btn btn-sm btn-bare" onClick={() => void decideProposal(p.id, null, null, actorId)}>
                undo
              </button>
            )}
            {!allowed && !decided && p.structural === 1 && <span className="muted small">needs manage_locations</span>}
          </div>
        );
      })}
    </div>
  );
}
