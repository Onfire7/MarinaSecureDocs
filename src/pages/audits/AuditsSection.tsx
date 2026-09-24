import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useRoleIdsFor } from "../../data/users";
import { useLocations } from "../../data/locations";
import { useMyPendingTargets, type MyTargetRow } from "../../data/audits";
import { orderTargets } from "../../lib/audits";

// The Audits section (docs/audits.md § Where an Audit appears). Rendered
// ABOVE every checklist section on a checkpoint scan and on the checklist
// view, so it cannot be missed, and as the top of the Audits page. It
// reports; it never gates a checklist. Collapsed to its progress header when
// more than five targets remain; sorted by distance when coordinates exist,
// tree order otherwise; scrolls the next target to the top when one is done.

export function AuditsSection({
  /** Only targets at or under this location (a checkpoint scan). */
  underLocationId,
  /** The Audits page: everything, never collapsed. */
  full = false,
}: {
  underLocationId?: string;
  full?: boolean;
}) {
  const current = useCurrent();
  const roleIds = useRoleIdsFor(current.user?.id);
  const { data: targets } = useMyPendingTargets(current.user?.id, roleIds, current.can("manage_audits"));
  const { data: locations } = useLocations();
  const [open, setOpen] = useState(full);
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const previousCount = useRef<number | null>(null);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setHere({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setHere(null),
      { timeout: 10_000 },
    );
  }, []);

  const shown = useMemo(() => {
    let list: MyTargetRow[] = targets;
    if (underLocationId) {
      const byId = new Map(locations.map((l) => [l.id, l.parent_id]));
      const under = (id: string | null): boolean => {
        let p = id;
        let guard = 0;
        while (p && guard++ < 32) {
          if (p === underLocationId) return true;
          p = byId.get(p) ?? null;
        }
        return false;
      };
      list = list.filter((t) => under(t.location_id));
    }
    const ordered = orderTargets(
      list.map((t, i) => ({ id: t.id, treeIndex: i, lat: t.gps_lat, lng: t.gps_lng })),
      here,
    );
    const byId = new Map(list.map((t) => [t.id, t]));
    return ordered.map((o) => byId.get(o.id)!);
  }, [targets, locations, underLocationId, here]);

  // When a target leaves the list (a finding was saved), bring the next one
  // to the top of the screen.
  useEffect(() => {
    if (previousCount.current !== null && shown.length < previousCount.current && topRef.current) {
      topRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
    }
    previousCount.current = shown.length;
  }, [shown.length]);

  if (shown.length === 0) {
    return full ? <p className="muted small">No audit locations assigned to you right now.</p> : null;
  }
  const audits = new Set(shown.map((t) => t.audit_id));
  const collapsed = !full && !open && shown.length > 5;
  return (
    <div ref={topRef} className="card" style={{ marginBottom: 14, borderLeft: "4px solid var(--accent)" }}>
      <button
        type="button"
        className="tree-head"
        onClick={() => !full && setOpen(!open)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span className="card-title">
          Audits · {shown.length} location{shown.length === 1 ? "" : "s"} to audit
        </span>
        <span className="muted small">
          {audits.size} audit{audits.size === 1 ? "" : "s"}
          {!full && (collapsed ? " · show" : " · hide")}
        </span>
      </button>
      {!collapsed && audits.size === 1 && (
        <Link to={`/audits/${[...audits][0]}/wizard`} className="btn btn-sm btn-primary" data-testid="section-wizard" style={{ marginTop: 8 }}>
          Start the wizard
        </Link>
      )}
      {!collapsed && (
        <div className="stack" style={{ gap: 6, marginTop: 8 }}>
          {shown.map((t) => (
            <Link key={t.id} to={`/audits/${t.audit_id}/targets/${t.id}`} className="tree-row" style={{ display: "block", border: "1px solid var(--line-lt)", borderRadius: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  <b>{t.location_name}</b>{" "}
                  <span className="muted small">
                    {t.type_name ?? ""}
                    {t.status_name ? ` · ${t.status_name}` : ""}
                  </span>
                </span>
                <span className="badge badge-accent">{t.audit_kind}</span>
              </div>
              <div className="muted small">
                {t.audit_name}
                {t.displaced_note && <span className="badge badge-warn" style={{ marginLeft: 6 }}>{t.displaced_note}</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
