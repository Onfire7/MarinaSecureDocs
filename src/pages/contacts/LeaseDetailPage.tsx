import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { displayName } from "../../lib/contacts";
import { compareNames } from "../../lib/locations";
import {
  addLeaseComment,
  addLeaseDocument,
  createLease,
  saveLease,
  setLessees,
  useLease,
  useLeaseComments,
  useLeaseDocuments,
  useLeaseLessees,
  type LeaseRow,
} from "../../data/leases";
import { useContacts } from "../../data/contacts";
import { useLocations } from "../../data/locations";
import { attachmentUrl, captureAttachment } from "../../data/files";

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

  const { lease } = useLease(leaseId);
  const { data: lessees } = useLeaseLessees(leaseId);
  const { data: documents } = useLeaseDocuments(leaseId);
  const { data: comments } = useLeaseComments(leaseId);

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
  const expired = lease.end_date != null && new Date(lease.end_date).getTime() < now;

  const addComment = async () => {
    if (!comment.trim() || !current.user) return;
    await addLeaseComment(lease.id, comment.trim(), current.user.id);
    setComment("");
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            Lease — {lease.location_name ?? "Unassigned location"}
          </h1>
          <div className="page-sub">
            {lease.start_date ? new Date(lease.start_date).toLocaleDateString() : "—"} –{" "}
            {lease.end_date
              ? new Date(lease.end_date).toLocaleDateString()
              : "open-ended"}
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
            <EditLease
              lease={lease}
              lesseeIds={lessees.map((l) => l.contact_id)}
              onDone={() => setEditing(false)}
            />
          ) : (
            <>
              {lease.location_id && (
                <div className="field">
                  <span className="field-label">Location</span>
                  <div className="field-value">
                    <Link to={`/locations/${lease.location_id}`}>
                      {lease.location_name}
                    </Link>
                  </div>
                </div>
              )}

              <div className="field">
                <span className="field-label">Lessees</span>
                <div className="field-value">
                  {lessees.length === 0 ? (
                    <span className="muted">None recorded</span>
                  ) : (
                    lessees.map((c) => (
                      <div key={c.link_id}>
                        <Link to={`/contacts/${c.contact_id}`}>{displayName(c)}</Link>
                        {current.can("view_contact") && c.phone && (
                          <span className="muted small">{` · ${c.phone}`}</span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {lease.variances_and_conditions && (
                <div className="field">
                  <span className="field-label">Variances & conditions</span>
                  <div className="card">
                    <div className="small" style={{ whiteSpace: "pre-wrap" }}>
                      {lease.variances_and_conditions}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <div>
            <div className="section-title">Documents</div>
            <div className="stack" style={{ gap: 6 }}>
              {documents.map((f) => {
                const url = attachmentUrl(f.storage_path);
                const name = f.storage_path?.split("/").pop() ?? "document";
                return url && f.upload_state === "uploaded" ? (
                  <a
                    key={f.id}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="card"
                    style={{ textDecoration: "none", color: "inherit", display: "block" }}
                  >
                    {name}
                  </a>
                ) : (
                  <div key={f.id} className="card muted small">
                    {name} — uploading
                  </div>
                );
              })}
              {documents.length === 0 && (
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
                  {c.author_name ?? "—"} ·{" "}
                  {new Date(c.created_at).toLocaleString(undefined, {
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

  const { data: allLocations } = useLocations();
  const { data: allContacts } = useContacts();
  // Only somewhere that's actually leasable — the picker used to offer every
  // location, root properties and grouping docks included, so the first guard
  // against leasing "the marina" was whoever was reading the list.
  const locations = allLocations.filter((l) => l.lease_enabled === 1);
  const contacts = allContacts.filter((c) => c.name);
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
    if (location?.reservation_enabled === 1) {
      const ok = window.confirm(
        `${location.name} currently accepts reservations. Creating a lease alongside that is allowed but unusual — continue?`,
      );
      if (!ok) return;
    }
    const leaseId = await createLease(
      {
        locationId: selectedLocation,
        startDate: startDate ? new Date(startDate).toISOString() : null,
        endDate: endDate ? new Date(endDate).toISOString() : null,
        variancesAndConditions: variances.trim() || null,
      },
      lesseeIds,
      location?.name ?? "a location",
      current.user?.id ?? null,
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
            .sort((a, b) => compareNames(a.name, b.name))
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
        {location?.reservation_enabled === 1 && (
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
  lesseeIds: initialLesseeIds,
  onDone,
}: {
  lease: LeaseRow;
  lesseeIds: string[];
  onDone: () => void;
}) {
  const current = useCurrent();
  const dateValue = (v: string | number | null | undefined) =>
    v ? new Date(v).toISOString().slice(0, 10) : "";
  const [startDate, setStartDate] = useState(dateValue(lease.start_date));
  const [endDate, setEndDate] = useState(dateValue(lease.end_date));
  const [variances, setVariances] = useState(lease.variances_and_conditions ?? "");
  const [lesseeIds, setLesseeIds] = useState(initialLesseeIds);

  const { data: allContacts } = useContacts();
  const contacts = allContacts.filter((c) => c.name);

  const save = async () => {
    await saveLease(
      lease.id,
      {
        startDate: startDate ? new Date(startDate).toISOString() : null,
        endDate: endDate ? new Date(endDate).toISOString() : null,
        variancesAndConditions: variances.trim() || null,
      },
      lease.location_name ?? "a location",
      current.user?.id ?? null,
    );
    await setLessees(lease.id, lesseeIds);
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
  const current = useCurrent();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const attachmentId = await captureAttachment(file, current.user?.id ?? null);
      await addLeaseDocument(leaseId, attachmentId);
    } catch (err) {
      // A lease document's bytes need a connection. Saying so beats a button
      // that appears to work and uploads nothing.
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="btn btn-sm" style={{ cursor: "pointer" }} title={error ?? undefined}>
      {busy ? "Uploading…" : error ? "⚠ Upload failed — retry" : "+ Upload document"}
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
