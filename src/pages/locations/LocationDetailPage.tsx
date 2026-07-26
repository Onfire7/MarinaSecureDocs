import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { db } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { NoteDialog } from "../shared/NoteDialog";
import { ManualCheckinDialog } from "../checklists/ManualCheckinDialog";
import { activityTx } from "../../lib/activityLog";
import type { AttachmentTarget } from "../../lib/attachments";
import {
  DEFAULT_POST_RESERVATION_STATUS,
  STANDARD_STATUSES,
  breadcrumb,
  compareNames,
  statusBadgeClass,
  statusLabel,
} from "../../lib/locations";

// Locations — Location Detail (see pages/location-detail.html).
// The hub for everything attached to one physical place. Owner, lease, and
// incident sections are omitted entirely (never shown locked) when the
// viewer lacks the gating permission.
export function LocationDetailPage() {
  const { id: locationId } = useParams();
  const current = useCurrent();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const canManage = current.can("manage_locations");
  const [showNoteDialog, setShowNoteDialog] = useState(false);
  const [showCheckin, setShowCheckin] = useState(false);

  const { data } = db.useQuery(
    locationId
      ? {
          locations: {
            $: { where: { id: locationId } },
            type: {},
            parent: {},
            children: { type: {} },
            currentBoat: { owners: {} },
            currentVehicle: { owners: {} },
            checkpoints: {},
            notes: { author: {} },
            incidents: {},
            tickets: {},
            leases: { lessees: {} },
            reservations: {
              $: { where: { status: { $in: ["requested", "confirmed"] } } },
              contact: {},
            },
          },
        }
      : null,
  );
  const location = data?.locations?.[0];

  const { data: crumbData } = db.useQuery({ locations: { parent: {} } });
  const byId = new Map(
    (crumbData?.locations ?? []).map((l) => [
      l.id,
      { name: l.name, parent: l.parent ? { id: l.parent.id } : null },
    ]),
  );

  if (!location) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const crumbs = breadcrumb(location.parent?.id, byId);
  // Presence of the field is driven by the type's flags; an occupant that
  // exists anyway (data predating a flag change) still shows.
  const carriesBoat = Boolean(location.type?.hasBoat || location.currentBoat);
  const carriesVehicle = Boolean(location.type?.hasVehicle || location.currentVehicle);
  // Owner section reflects whichever occupant is present (boat first).
  const owners = [
    ...(location.currentBoat?.owners ?? []),
    ...(location.currentVehicle?.owners ?? []),
  ];
  const now = Date.now();
  const activeLease = (location.leases ?? []).find(
    (l) =>
      (!l.startDate || new Date(l.startDate).getTime() <= now) &&
      (!l.endDate || new Date(l.endDate).getTime() >= now),
  );
  const upcoming = (location.reservations ?? [])
    .filter((r) => r.expectedCheckin && new Date(r.expectedCheckin).getTime() > now - 24 * 3600_000)
    .sort(
      (a, b) =>
        new Date(a.expectedCheckin!).getTime() - new Date(b.expectedCheckin!).getTime(),
    )[0];

  const setStatus = (status: string) => {
    void db.transact([
      db.tx.locations[location.id].update({ status }),
      activityTx({
        eventType: "location.status_changed",
        summary: `${location.name} set to ${statusLabel(status)}`,
        subjectType: "locations",
        subjectId: location.id,
        actorId: current.user?.id,
      }),
    ]);
  };

  const toggleReservations = () => {
    const enabling = !location.reservationEnabled;
    if (enabling && activeLease) {
      const ok = window.confirm(
        "This location has an active lease. Enabling reservations alongside a lease is allowed but unusual — continue?",
      );
      if (!ok) return;
    }
    void db.transact(
      db.tx.locations[location.id].update({
        reservationEnabled: enabling,
        // First enable establishes the post-checkout default.
        ...(enabling && !location.postReservationStatus
          ? { postReservationStatus: DEFAULT_POST_RESERVATION_STATUS }
          : {}),
      }),
    );
  };

  const setPostReservationStatus = (status: string) => {
    void db.transact(
      db.tx.locations[location.id].update({ postReservationStatus: status }),
    );
  };

  const children = [...(location.children ?? [])].sort((a, b) =>
    compareNames(a.name, b.name),
  );

  const selfTarget: AttachmentTarget = {
    type: "location",
    id: location.id,
    label: location.name,
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">{location.name}</h1>
          <div className="page-sub">
            {location.type?.name}
            {crumbs.length > 0 && ` · ${crumbs.join(" → ")}`}
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn btn-sm" onClick={() => setShowNoteDialog(true)}>
            + Note
          </button>
          {current.can("create_incidents") && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                navigate("/incidents/new", { state: { target: selfTarget } })
              }
            >
              + Incident
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => navigate("/tickets/new", { state: { target: selfTarget } })}
          >
            + Ticket
          </button>
          {(location.checkpoints ?? []).length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setShowCheckin(true)}
            >
              Check in manually
            </button>
          )}
        </div>
      </div>

      <div className={isMobile ? undefined : "grid-2"}>
        <div>
          {location.type?.tracksStatus && (
          <div className="field">
            <span className="field-label">Status</span>
            <div className="field-value row">
              {canManage ? (
                <select
                  className="select select-inline"
                  value={location.status ?? "vacant"}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {[
                    ...new Set([...STANDARD_STATUSES, location.status ?? "vacant"]),
                  ].map((s) => (
                    <option key={s} value={s}>
                      {statusLabel(s)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={statusBadgeClass(location.status)}>
                  {statusLabel(location.status)}
                </span>
              )}
              {upcoming && (
                <span className="badge badge-warn">
                  Upcoming reservation{" "}
                  {new Date(upcoming.expectedCheckin!).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </div>
          </div>
          )}

          {location.type?.allowsReservations && canManage && (
            <div className="field">
              <span className="field-label">Reservations</span>
              <label className="row" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={location.reservationEnabled}
                  onChange={toggleReservations}
                />
                <span className="small">
                  {location.reservationEnabled ? "Enabled" : "Disabled"} for this location
                </span>
              </label>
              {location.reservationEnabled && (
                <div className="row" style={{ marginTop: 6 }}>
                  <span className="small muted">After check-out becomes</span>
                  <select
                    className="select select-inline"
                    value={
                      location.postReservationStatus ?? DEFAULT_POST_RESERVATION_STATUS
                    }
                    onChange={(e) => setPostReservationStatus(e.target.value)}
                  >
                    {[
                      ...new Set([
                        ...STANDARD_STATUSES,
                        location.postReservationStatus ?? DEFAULT_POST_RESERVATION_STATUS,
                      ]),
                    ].map((s) => (
                      <option key={s} value={s}>
                        {statusLabel(s)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {carriesBoat && (
            <div className="field">
              <span className="field-label">Current boat</span>
              <div className="field-value">
                {location.currentBoat ? (
                  <Link to={`/boats/${location.currentBoat.id}`}>
                    {location.currentBoat.name}
                  </Link>
                ) : (
                  <span className="muted">Vacant — no boat</span>
                )}
              </div>
            </div>
          )}

          {carriesVehicle && (
            <div className="field">
              <span className="field-label">Current vehicle</span>
              <div className="field-value">
                {location.currentVehicle ? (
                  <Link to={`/vehicles/${location.currentVehicle.id}`}>
                    {location.currentVehicle.description}
                    {location.currentVehicle.plateNumber
                      ? ` · ${location.currentVehicle.plateNumber}`
                      : ""}
                  </Link>
                ) : (
                  <span className="muted">Vacant — no vehicle</span>
                )}
              </div>
            </div>
          )}

          {current.can("view_owner") && owners.length > 0 && (
            <div className="field">
              <span className="field-label">Owner{owners.length > 1 ? "s" : ""}</span>
              <div className="field-value">
                {owners.map((o) => (
                  <div key={o.id}>
                    <Link to={`/contacts/${o.id}`}>{o.name ?? "Unnamed contact"}</Link>
                    {current.can("view_contact") && (
                      <span className="muted small">
                        {o.phone ? ` · ${o.phone}` : ""}
                        {o.email ? ` · ${o.email}` : ""}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {current.can("view_lease") && (
            <div className="field">
              <span className="field-label">Lease</span>
              {activeLease ? (
                <div className="field-value">
                  <Link to={`/contacts/leases/${activeLease.id}`}>
                    {(activeLease.lessees ?? [])
                      .map((c) => c.name ?? "Unnamed")
                      .join(", ") || "Lease on file"}
                  </Link>
                  <span className="muted small">
                    {activeLease.endDate
                      ? ` · through ${new Date(activeLease.endDate).toLocaleDateString()}`
                      : " · open-ended"}
                  </span>
                </div>
              ) : current.can("manage_lease") ? (
                <div className="field-value">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() =>
                      navigate("/contacts/leases/new", {
                        state: { locationId: location.id },
                      })
                    }
                  >
                    + Add a lease
                  </button>
                </div>
              ) : (
                <div className="field-value muted">None</div>
              )}
            </div>
          )}
        </div>

        <div className="stack">
          <Section title={`Checkpoints (${(location.checkpoints ?? []).length})`} isMobile={isMobile}>
            {(location.checkpoints ?? []).map((cp) => (
              <Link key={cp.id} to={`/locations/checkpoints/${cp.id}`} className="card" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                <span className="card-title">{cp.name}</span>
              </Link>
            ))}
            {(location.checkpoints ?? []).length === 0 && (
              <span className="muted small">
                None here.
                {canManage && (
                  <>
                    {" "}
                    <Link to="/admin">Add one in Admin →</Link>
                  </>
                )}
              </span>
            )}
          </Section>

          {children.length > 0 && (
            <Section title={`Contains (${children.length})`} isMobile={isMobile}>
              {children.map((c) => (
                <Link key={c.id} to={`/locations/${c.id}`} className="card spread" style={{ textDecoration: "none", color: "inherit" }}>
                  <span className="card-title">{c.name}</span>
                  {c.type?.tracksStatus && (
                    <span className={statusBadgeClass(c.status)}>
                      {statusLabel(c.status)}
                    </span>
                  )}
                </Link>
              ))}
            </Section>
          )}

          <Section title={`Notes (${(location.notes ?? []).length})`} isMobile={isMobile}>
            {[...(location.notes ?? [])]
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map((n) => (
                <div key={n.id} className="card">
                  <div className="small">{n.body}</div>
                  <div className="card-meta">
                    {n.author?.name ?? "—"} ·{" "}
                    {new Date(n.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              ))}
            {(location.notes ?? []).length === 0 && (
              <span className="muted small">No notes yet.</span>
            )}
          </Section>

          {current.can("view_incidents") && (
            <Section title={`Incidents (${(location.incidents ?? []).length})`} isMobile={isMobile}>
              {(location.incidents ?? []).map((i) => (
                <Link key={i.id} to="/incidents" className="card spread" style={{ textDecoration: "none", color: "inherit" }}>
                  <span>{i.title}</span>
                  <span className="badge">{statusLabel(i.status)}</span>
                </Link>
              ))}
              {(location.incidents ?? []).length === 0 && (
                <span className="muted small">No incidents.</span>
              )}
            </Section>
          )}

          <Section title={`Tickets (${(location.tickets ?? []).length})`} isMobile={isMobile}>
            {(location.tickets ?? []).map((t) => (
              <Link key={t.id} to="/tickets" className="card spread" style={{ textDecoration: "none", color: "inherit" }}>
                <span>{t.title}</span>
                <span
                  className={
                    t.priority === "urgent" || t.priority === "high"
                      ? "badge badge-bad"
                      : "badge"
                  }
                >
                  {statusLabel(t.priority)}
                </span>
              </Link>
            ))}
            {(location.tickets ?? []).length === 0 && (
              <span className="muted small">No tickets.</span>
            )}
          </Section>
        </div>
      </div>

      {showNoteDialog && (
        <NoteDialog target={selfTarget} onClose={() => setShowNoteDialog(false)} />
      )}

      {showCheckin && (
        <ManualCheckinDialog
          initialCheckpointId={(location.checkpoints ?? [])[0]?.id}
          onClose={() => setShowCheckin(false)}
        />
      )}
    </div>
  );
}

// Mobile collapses sections by default to keep the initial view scannable;
// desktop shows everything at once (see spec — Mobile vs. desktop).
function Section({
  title,
  isMobile,
  children,
}: {
  title: string;
  isMobile: boolean;
  children: ReactNode;
}) {
  if (!isMobile) {
    return (
      <div>
        <div className="section-title">{title}</div>
        <div className="stack" style={{ gap: 8 }}>{children}</div>
      </div>
    );
  }
  return (
    <details className="section-collapse">
      <summary className="section-title">{title}</summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>{children}</div>
    </details>
  );
}
