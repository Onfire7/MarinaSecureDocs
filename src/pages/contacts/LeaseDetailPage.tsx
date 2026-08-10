import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { displayName } from "../../lib/contacts";

export interface NewLeaseState {
  locationId?: string;
}

// Owners & Contacts — Lease Detail (see docs/pages/lease-detail.html).
// Gated entirely by view_lease; edits/uploads/comments by manage_lease.
// Doubles as the creation form when reached from Location detail's
// "Add a lease" with no lease id.
export function LeaseDetailPage({ mode }: { mode?: "create" }) {
  const { id: leaseId } = useParams();
  const current = useCurrent();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as NewLeaseState;
  const canView = current.can("view_lease");
  const canManage = current.can("manage_lease");
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(mode === "create");

  const { data } = db.useQuery(
    canView && leaseId
      ? {
          leases: {
            $: { where: { id: leaseId } },
            location: {},
            lessees: {},
            documents: {},
            comments: { author: {} },
          },
        }
      : null,
  );
  const lease = data?.leases?.[0];

  if (!canView) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
      </div>
    );
  }

  if (mode === "create") {
    return <CreateLease locationId={state.locationId} onCancel={() => navigate(-1)} />;
  }

  if (!lease) {
    return (
      <div className="placeholder">
        <div className="big">Loading…</div>
      </div>
    );
  }

  const now = Date.now();
  const expired = lease.endDate != null && new Date(lease.endDate).getTime() < now;

  const addComment = async () => {
    if (!comment.trim() || !current.user) return;
    await db.transact(
      db.tx.leaseComments[id()]
        .update({ body: comment.trim(), createdAt: Date.now() })
        .link({ lease: lease.id, author: current.user.id }),
    );
    setComment("");
  };

  const comments = [...(lease.comments ?? [])].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            Lease — {lease.location?.name ?? "Unassigned location"}
          </h1>
          <div className="page-sub">
            {lease.startDate ? new Date(lease.startDate).toLocaleDateString() : "—"} –{" "}
            {lease.endDate ? new Date(lease.endDate).toLocaleDateString() : "open-ended"}
            {expired && (
              <span className="badge badge-warn" style={{ marginLeft: 8 }}>
                Expired
              </span>
            )}
          </div>
        </div>
        {canManage && !editing && (
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>

      <div className="grid-2">
        <div className="stack">
          {editing ? (
            <EditLease lease={lease} onDone={() => setEditing(false)} />
          ) : (
            <>
              {lease.location && (
                <div className="field">
                  <span className="field-label">Location</span>
                  <div className="field-value">
                    <Link to={`/locations/${lease.location.id}`}>
                      {lease.location.name}
                    </Link>
                  </div>
                </div>
              )}

              <div className="field">
                <span className="field-label">Lessees</span>
                <div className="field-value">
                  {(lease.lessees ?? []).length === 0 ? (
                    <span className="muted">None recorded</span>
                  ) : (
                    (lease.lessees ?? []).map((c) => (
                      <div key={c.id}>
                        <Link to={`/contacts/${c.id}`}>{displayName(c)}</Link>
                        {current.can("view_contact") && (
                          <span className="muted small">
                            {c.phone ? ` · ${c.phone}` : ""}
                            {c.email ? ` · ${c.email}` : ""}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {lease.variancesAndConditions && (
                <div className="field">
                  <span className="field-label">Variances & conditions</span>
                  <div className="card">
                    <div className="small" style={{ whiteSpace: "pre-wrap" }}>
                      {lease.variancesAndConditions}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <div>
            <div className="section-title">Documents</div>
            <div className="stack" style={{ gap: 6 }}>
              {(lease.documents ?? []).map((f) => (
                <a
                  key={f.id}
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="card"
                  style={{ textDecoration: "none", color: "inherit", display: "block" }}
                >
                  {f.path.split("/").pop()}
                </a>
              ))}
              {(lease.documents ?? []).length === 0 && (
                <span className="muted small">No documents uploaded.</span>
              )}
              {canManage && <UploadDocument leaseId={lease.id} />}
            </div>
          </div>
        </div>

        <div>
          <div className="section-title">Comments</div>
          <div className="stack" style={{ gap: 8 }}>
            {comments.map((c) => (
              <div key={c.id} className="card">
                <div className="small" style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
                <div className="card-meta">
                  {c.author?.name ?? "—"} ·{" "}
                  {new Date(c.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ))}
            {comments.length === 0 && (
              <span className="muted small">No comments yet.</span>
            )}
          </div>

          {canManage && (
            <div style={{ marginTop: 12 }}>
              <textarea
                className="textarea"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add a comment"
              />
              <div className="row" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={!comment.trim()}
                  onClick={() => void addComment()}
                >
                  Add comment
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Creating a lease on a reservation-enabled Location warns but doesn't block
// (see spec) — and doesn't itself turn reservations off.
function CreateLease({
  locationId,
  onCancel,
}: {
  locationId: string | undefined;
  onCancel: () => void;
}) {
  const current = useCurrent();
  const navigate = useNavigate();
  const [selectedLocation, setSelectedLocation] = useState(locationId ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [lesseeIds, setLesseeIds] = useState<string[]>([]);
  const [variances, setVariances] = useState("");

  const { data } = db.useQuery({ locations: { type: {} }, contacts: {} });
  // Only somewhere that's actually leasable — the picker used to offer every
  // location, root properties and grouping docks included, so the first
  // guard against leasing "the marina" was whoever was reading the list.
  const locations = (data?.locations ?? []).filter((l) => l.leaseEnabled);
  const contacts = (data?.contacts ?? []).filter((c) => c.name);
  const location = locations.find((l) => l.id === selectedLocation);

  if (!current.can("manage_lease")) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
      </div>
    );
  }

  const create = async () => {
    if (!selectedLocation) return;
    if (location?.reservationEnabled) {
      const ok = window.confirm(
        `${location.name} currently accepts reservations. Creating a lease alongside that is allowed but unusual — continue?`,
      );
      if (!ok) return;
    }
    const leaseId = id();
    await db.transact(
      db.tx.leases[leaseId]
        .update({
          startDate: startDate ? new Date(startDate).getTime() : undefined,
          endDate: endDate ? new Date(endDate).getTime() : undefined,
          variancesAndConditions: variances.trim() || undefined,
        })
        .link({
          location: selectedLocation,
          ...(lesseeIds.length > 0 ? { lessees: lesseeIds } : {}),
        }),
    );
    navigate(`/contacts/leases/${leaseId}`, { replace: true });
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="page-head">
        <h1 className="page-title">New Lease</h1>
      </div>

      <div className="field">
        <span className="field-label">Location — required</span>
        <select
          className="select"
          value={selectedLocation}
          onChange={(e) => setSelectedLocation(e.target.value)}
        >
          <option value="">Select…</option>
          {[...locations]
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
        {locations.length === 0 && (
          <p className="muted small" style={{ marginTop: 4 }}>
            Nothing is marked leasable yet — switch it on for a location in
            Admin → Location Types &amp; Locations.
          </p>
        )}
        {location?.reservationEnabled && (
          <p className="muted small" style={{ marginTop: 4 }}>
            Note: this location currently accepts reservations.
          </p>
        )}
      </div>

      <div className="field">
        <span className="field-label">Start / end date</span>
        <div className="row">
          <input
            type="date"
            className="input select-inline"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <input
            type="date"
            className="input select-inline"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <span className="field-label">Lessees</span>
        <select
          className="select"
          multiple
          size={Math.min(6, Math.max(3, contacts.length))}
          value={lesseeIds}
          onChange={(e) =>
            setLesseeIds([...e.target.selectedOptions].map((o) => o.value))
          }
        >
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {displayName(c)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <span className="field-label">Variances & conditions</span>
        <textarea
          className="textarea"
          rows={4}
          value={variances}
          onChange={(e) => setVariances(e.target.value)}
        />
      </div>

      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!selectedLocation}
          onClick={() => void create()}
        >
          Create lease
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function EditLease({
  lease,
  onDone,
}: {
  lease: {
    id: string;
    startDate?: string | number | null;
    endDate?: string | number | null;
    variancesAndConditions?: string | null;
    lessees?: { id: string }[];
  };
  onDone: () => void;
}) {
  const dateValue = (v: string | number | null | undefined) =>
    v ? new Date(v).toISOString().slice(0, 10) : "";
  const [startDate, setStartDate] = useState(dateValue(lease.startDate));
  const [endDate, setEndDate] = useState(dateValue(lease.endDate));
  const [variances, setVariances] = useState(lease.variancesAndConditions ?? "");
  const [lesseeIds, setLesseeIds] = useState((lease.lessees ?? []).map((c) => c.id));

  const { data } = db.useQuery({ contacts: {} });
  const contacts = (data?.contacts ?? []).filter((c) => c.name);
  const original = (lease.lessees ?? []).map((c) => c.id);

  const save = async () => {
    const added = lesseeIds.filter((i) => !original.includes(i));
    const removed = original.filter((i) => !lesseeIds.includes(i));
    await db.transact([
      db.tx.leases[lease.id].update({
        startDate: startDate ? new Date(startDate).getTime() : undefined,
        endDate: endDate ? new Date(endDate).getTime() : undefined,
        variancesAndConditions: variances.trim() || undefined,
      }),
      ...(added.length > 0 ? [db.tx.leases[lease.id].link({ lessees: added })] : []),
      ...(removed.length > 0
        ? [db.tx.leases[lease.id].unlink({ lessees: removed })]
        : []),
    ]);
    onDone();
  };

  return (
    <div className="card">
      <div className="field">
        <span className="field-label">Start / end date</span>
        <div className="row">
          <input
            type="date"
            className="input select-inline"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <input
            type="date"
            className="input select-inline"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <span className="field-label">Lessees</span>
        <select
          className="select"
          multiple
          size={Math.min(6, Math.max(3, contacts.length))}
          value={lesseeIds}
          onChange={(e) =>
            setLesseeIds([...e.target.selectedOptions].map((o) => o.value))
          }
        >
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {displayName(c)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span className="field-label">Variances & conditions</span>
        <textarea
          className="textarea"
          rows={4}
          value={variances}
          onChange={(e) => setVariances(e.target.value)}
        />
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function UploadDocument({ leaseId }: { leaseId: string }) {
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setBusy(true);
    try {
      const path = `leases/${leaseId}/${Date.now()}-${file.name}`;
      const { data } = await db.storage.uploadFile(path, file);
      await db.transact(db.tx.leases[leaseId].link({ documents: data.id }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="btn btn-sm" style={{ cursor: "pointer" }}>
      {busy ? "Uploading…" : "+ Upload document"}
      <input
        type="file"
        style={{ display: "none" }}
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
    </label>
  );
}
