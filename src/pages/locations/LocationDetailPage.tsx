import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { useIsMobile } from "../../hooks/useIsMobile";
import { NoteDialog } from "../shared/NoteDialog";
import { ManualCheckinDialog } from "../checklists/ManualCheckinDialog";
import type { AttachmentTarget } from "../../data/attachments";
import {
  breadcrumb,
  compareNames,
  statusBadgeClass,
  statusLabel,
} from "../../lib/locations";
import {
  setLocationStatus,
  tracksStatus,
  useChildLocations,
  useLocation as useLocationRow,
  useLocations,
} from "../../data/locations";
import { useLocationStatuses } from "../../data/lookups";
import { useCheckpointsForLocation } from "../../data/checkpoints";
import { useNotesForTarget } from "../../data/notes";
import { useIncidentsForTarget } from "../../data/incidents";
import { useTicketsForTarget } from "../../data/tickets";
import { useLeasesForLocation } from "../../data/leases";
import { useReservationsForTarget } from "../../data/reservations";
import { useBoatOwners, useVehicleOwners } from "../../data/boats";

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

  const { location } = useLocationRow(locationId);
  const { data: allLocations } = useLocations();
  const { data: children } = useChildLocations(locationId);
  const { data: checkpoints } = useCheckpointsForLocation(locationId);
  const { data: notes } = useNotesForTarget("location_id", locationId);
  const { data: incidents } = useIncidentsForTarget("location_id", locationId);
  const { data: tickets } = useTicketsForTarget("location_id", locationId);
  const { data: leases } = useLeasesForLocation(locationId);
  const { data: reservations } = useReservationsForTarget("location", locationId);
  const { statuses } = useLocationStatuses();
  // Owners of whichever occupant is here — boat first, then vehicle.
  const { data: boatOwners } = useBoatOwners(location?.current_boat_id ?? undefined);
  const { data: vehicleOwners } = useVehicleOwners(
    location?.current_vehicle_id ?? undefined,
  );

  const byId = new Map(
    allLocations.map((l) => [l.id, { name: l.name, parent_id: l.parent_id }]),
  );

  if (!location) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const crumbs = breadcrumb(location.parent_id ?? undefined, byId);
  // Presence of the field is driven by the type's flags; an occupant that
  // exists anyway (data predating a flag change) still shows.
  const carriesBoat = Boolean(location.current_boat_id) || location.boat_name != null;
  const carriesVehicle =
    Boolean(location.current_vehicle_id) || location.vehicle_description != null;
  const owners = [...boatOwners, ...vehicleOwners];
  const now = Date.now();
  const activeLease = leases.find(
    (l) =>
      (!l.start_date || new Date(l.start_date).getTime() <= now) &&
      (!l.end_date || new Date(l.end_date).getTime() >= now),
  );
  const upcoming = reservations
    .filter(
      (r) =>
        (r.status === "requested" || r.status === "confirmed") &&
        r.expected_checkin &&
        new Date(r.expected_checkin).getTime() > now - 24 * 3600_000,
    )
    .sort(
      (a, b) =>
        new Date(a.expected_checkin!).getTime() -
        new Date(b.expected_checkin!).getTime(),
    )[0];

  const setStatus = (statusId: string) => {
    const status = statuses.find((st) => st.id === statusId);
    if (status) void setLocationStatus(location, status, current.user?.id ?? null);
  };

  const sortedChildren = [...children].sort((a, b) => compareNames(a.name, b.name));

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
            {location.type_name}
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
          {checkpoints.length > 0 && (
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
          {tracksStatus(location) && (
          <div className="field">
            <span className="field-label">Status</span>
            <div className="field-value row">
              {canManage ? (
                <select
                  className="select select-inline"
                  value={location.status_id ?? ""}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {!location.status_id && <option value="">—</option>}
                  {statuses.map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className={statusBadgeClass(location.status_name)}>
                  {location.status_name ?? "—"}
                </span>
              )}
              {upcoming && (
                <span className="badge badge-warn">
                  Upcoming reservation{" "}
                  {new Date(upcoming.expected_checkin!).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </div>
          </div>
          )}

          {/* Whether a location takes reservations, and what it becomes after
              one, is configuration — it belongs with the rest of a
              location's setup in Admin, not on the page a guard opens to see
              what's in front of them. Status stays: marking a slip
              needs_cleaning is the work, not a setting. */}

          {carriesBoat && (
            <div className="field">
              <span className="field-label">Current boat</span>
              <div className="field-value">
                {location.current_boat_id ? (
                  <Link to={`/boats/${location.current_boat_id}`}>
                    {location.boat_name}
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
                {location.current_vehicle_id ? (
                  <Link to={`/vehicles/${location.current_vehicle_id}`}>
                    {location.vehicle_description}
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
                  <div key={o.link_id}>
                    <Link to={`/contacts/${o.contact_id}`}>
                      {o.name ?? "Unnamed contact"}
                    </Link>
                    {current.can("view_contact") && o.phone && (
                      <span className="muted small">{` · ${o.phone}`}</span>
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
                    {activeLease.lessee_names || "Lease on file"}
                  </Link>
                  <span className="muted small">
                    {activeLease.end_date
                      ? ` · through ${new Date(activeLease.end_date).toLocaleDateString()}`
                      : " · open-ended"}
                  </span>
                </div>
              ) : current.can("manage_lease") && location.lease_enabled === 1 ? (
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
          <Section title={`Checkpoints (${checkpoints.length})`} isMobile={isMobile}>
            {checkpoints.map((cp) => (
              <Link key={cp.id} to={`/locations/checkpoints/${cp.id}`} className="card" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
                <span className="card-title">{cp.name}</span>
              </Link>
            ))}
            {checkpoints.length === 0 && (
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

          {sortedChildren.length > 0 && (
            <Section title={`Contains (${sortedChildren.length})`} isMobile={isMobile}>
              {sortedChildren.map((c) => (
                <Link key={c.id} to={`/locations/${c.id}`} className="card spread" style={{ textDecoration: "none", color: "inherit" }}>
                  <span className="card-title">{c.name}</span>
                  {tracksStatus(c) && (
                    <span className={statusBadgeClass(c.status_name)}>
                      {c.status_name ?? "—"}
                    </span>
                  )}
                </Link>
              ))}
            </Section>
          )}

          <Section title={`Notes (${notes.length})`} isMobile={isMobile}>
            {notes.map((n) => (
              <div key={n.id} className="card">
                <div className="small">{n.body}</div>
                <div className="card-meta">
                  {n.author_name ?? "—"} ·{" "}
                  {new Date(n.created_at).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ))}
            {notes.length === 0 && (
              <span className="muted small">No notes yet.</span>
            )}
          </Section>

          {current.can("view_incidents") && (
            <Section title={`Incidents (${incidents.length})`} isMobile={isMobile}>
              {incidents.map((i) => (
                <Link key={i.id} to={`/incidents/${i.id}`} className="card spread" style={{ textDecoration: "none", color: "inherit" }}>
                  <span>{i.title}</span>
                  <span className="badge">{i.status_name}</span>
                </Link>
              ))}
              {incidents.length === 0 && (
                <span className="muted small">No incidents.</span>
              )}
            </Section>
          )}

          <Section title={`Tickets (${tickets.length})`} isMobile={isMobile}>
            {tickets.map((t) => (
              <Link key={t.id} to={`/tickets/${t.id}`} className="card spread" style={{ textDecoration: "none", color: "inherit" }}>
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
            {tickets.length === 0 && (
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
          initialCheckpointId={checkpoints[0]?.id}
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
