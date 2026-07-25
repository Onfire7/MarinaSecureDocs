import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { rangesOverlap } from "../../lib/reservations";

export interface NewReservationState {
  targetKind?: "location" | "asset";
  targetId?: string;
}

// Reservations — New Reservation Form (see docs/pages/new-reservation-form.html).
// Gated by manage_reservations. The target picker only ever offers
// reservation-enabled Locations and Assets — a mixed-use dock's leased slips
// simply never appear here.
export function NewReservationPage() {
  const current = useCurrent();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as NewReservationState;

  const [targetKey, setTargetKey] = useState(
    state.targetKind && state.targetId ? `${state.targetKind}:${state.targetId}` : "",
  );
  const [contactId, setContactId] = useState("");
  const [creatingContact, setCreatingContact] = useState(false);
  const [newContact, setNewContact] = useState({ name: "", phone: "", email: "" });
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [rate, setRate] = useState("");
  const [deposit, setDeposit] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data } = db.useQuery({
    locations: { $: { where: { reservationEnabled: true } }, type: {} },
    assets: { $: { where: { reservationEnabled: true } } },
    contacts: {},
    marinaSettings: {},
  });

  const locations = data?.locations ?? [];
  const assets = data?.assets ?? [];
  const contacts = useMemo(
    () =>
      [...(data?.contacts ?? [])].sort((a, b) =>
        (a.name ?? "").localeCompare(b.name ?? ""),
      ),
    [data],
  );
  const allowOverlap = data?.marinaSettings?.[0]?.allowOverlappingReservations ?? false;

  if (!current.can("manage_reservations")) {
    return (
      <div className="placeholder">
        <div className="big">Nothing to see here</div>
      </div>
    );
  }

  const [targetKind, targetId] = targetKey.split(":") as [
    "location" | "asset" | "",
    string | undefined,
  ];
  const selectedLocation = targetKind === "location" ? locations.find((l) => l.id === targetId) : undefined;
  const selectedAsset = targetKind === "asset" ? assets.find((a) => a.id === targetId) : undefined;
  const isPublic =
    (selectedLocation?.reservationVisibility ?? selectedAsset?.reservationVisibility) ===
    "public";

  const submit = async () => {
    if (!targetId || !checkin) return;
    setError(null);
    setSaving(true);

    const start = new Date(checkin).getTime();
    const end = checkout ? new Date(checkout).getTime() : start + 24 * 3600_000;

    // Overlap guard (MarinaSettings.allowOverlappingReservations, default off):
    // blocked outright with the conflicting reservation named.
    if (!allowOverlap) {
      const { data: existing } =
        targetKind === "location"
          ? await db.queryOnce({
              reservations: {
                $: {
                  where: {
                    "location.id": targetId,
                    status: { $in: ["requested", "confirmed", "checked_in"] },
                  },
                },
                contact: {},
              },
            })
          : await db.queryOnce({
              reservations: {
                $: {
                  where: {
                    "asset.id": targetId,
                    status: { $in: ["requested", "confirmed", "checked_in"] },
                  },
                },
                contact: {},
              },
            });
      const conflict = (existing?.reservations ?? []).find((r) => {
        if (!r.expectedCheckin) return false;
        const rs = new Date(r.expectedCheckin).getTime();
        const re = r.expectedCheckout
          ? new Date(r.expectedCheckout).getTime()
          : rs + 24 * 3600_000;
        return rangesOverlap(start, end, rs, re);
      });
      if (conflict) {
        setError(
          `Conflicts with the existing reservation for ${
            conflict.contact?.name ?? "an unnamed contact"
          } (${new Date(conflict.expectedCheckin!).toLocaleDateString()}${
            conflict.expectedCheckout
              ? ` – ${new Date(conflict.expectedCheckout).toLocaleDateString()}`
              : ""
          }).`,
        );
        setSaving(false);
        return;
      }
    }

    let contact = contactId;
    const txns = [];
    if (creatingContact && newContact.name.trim()) {
      contact = id();
      txns.push(
        db.tx.contacts[contact].update({
          name: newContact.name.trim(),
          phone: newContact.phone.trim() || undefined,
          email: newContact.email.trim() || undefined,
        }),
      );
    }

    const reservationId = id();
    txns.push(
      db.tx.reservations[reservationId]
        .update({
          status: confirmed ? "confirmed" : "requested",
          expectedCheckin: start,
          expectedCheckout: checkout ? end : null,
          ...(isPublic && rate !== "" ? { rate: Number(rate) } : {}),
          ...(isPublic && deposit !== "" ? { deposit: Number(deposit) } : {}),
        })
        .link({
          [targetKind]: targetId,
          ...(contact ? { contact } : {}),
        }),
    );
    await db.transact(txns);
    navigate(`/reservations/${reservationId}`, { replace: true });
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="page-head">
        <h1 className="page-title">New Reservation</h1>
      </div>

      <div className="field">
        <span className="field-label">Target — reservable locations & assets only</span>
        <select
          className="select"
          value={targetKey}
          onChange={(e) => setTargetKey(e.target.value)}
        >
          <option value="">Select…</option>
          <optgroup label="Locations">
            {locations.map((l) => (
              <option key={l.id} value={`location:${l.id}`}>
                {l.name}
                {l.type?.name ? ` (${l.type.name})` : ""}
              </option>
            ))}
          </optgroup>
          <optgroup label="Assets">
            {assets.map((a) => (
              <option key={a.id} value={`asset:${a.id}`}>
                {a.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      <div className="field">
        <span className="field-label">Contact</span>
        {creatingContact ? (
          <div className="stack" style={{ gap: 6 }}>
            <input
              className="input"
              placeholder="Name"
              value={newContact.name}
              onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
            />
            <input
              className="input"
              placeholder="Phone (optional)"
              value={newContact.phone}
              onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
            />
            <input
              className="input"
              placeholder="Email (optional)"
              value={newContact.email}
              onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              onClick={() => setCreatingContact(false)}
            >
              Pick an existing contact instead
            </button>
          </div>
        ) : (
          <div className="row">
            <select
              className="select"
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
            >
              <option value="">Select…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? "Unnamed contact"}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setCreatingContact(true)}
            >
              + New
            </button>
          </div>
        )}
      </div>

      <div className="field">
        <span className="field-label">Expected check-in / check-out</span>
        <div className="row">
          <input
            type="date"
            className="input select-inline"
            value={checkin}
            onChange={(e) => setCheckin(e.target.value)}
          />
          <input
            type="date"
            className="input select-inline"
            value={checkout}
            onChange={(e) => setCheckout(e.target.value)}
          />
        </div>
      </div>

      {isPublic && (
        <div className="field">
          <span className="field-label">Rate / deposit</span>
          <div className="row">
            <input
              type="number"
              className="input select-inline"
              placeholder="Rate"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
            />
            <input
              type="number"
              className="input select-inline"
              placeholder="Deposit"
              value={deposit}
              onChange={(e) => setDeposit(e.target.value)}
            />
          </div>
        </div>
      )}

      <label className="row" style={{ cursor: "pointer", marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span className="small">Confirmed immediately (skip the Requested step)</span>
      </label>

      {error && (
        <div className="badge badge-bad" style={{ display: "block", marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={
            !targetId ||
            !checkin ||
            saving ||
            (!contactId && !(creatingContact && newContact.name.trim()))
          }
          onClick={() => void submit()}
        >
          Create Reservation
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
