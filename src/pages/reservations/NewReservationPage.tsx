import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { LocationPicker } from "../shared/LocationPicker";
import {
  createReservation,
  findConflict,
} from "../../data/reservations";
import { createContact, useContacts } from "../../data/contacts";
import { useLocations } from "../../data/locations";
import { useAssets } from "../../data/assets";
import { useMarinaSettings } from "../../data/settings";

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
  // Null until the user picks explicitly; falls back to the target's default.
  const [billingChoice, setBillingChoice] = useState<"billable" | "non_billable" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: allLocations } = useLocations();
  const { data: allAssets } = useAssets();
  const { data: allContacts } = useContacts();
  const settings = useMarinaSettings();

  // The picker only ever offers reservation-enabled targets — a mixed-use
  // dock's leased slips simply never appear here.
  const locations = useMemo(
    () => allLocations.filter((l) => l.reservation_enabled === 1),
    [allLocations],
  );
  const assets = useMemo(
    () => allAssets.filter((a) => a.reservation_enabled === 1),
    [allAssets],
  );
  const contacts = useMemo(
    () => [...allContacts].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    [allContacts],
  );
  const allowOverlap = settings.allowOverlappingReservations;

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
  // The target's visibility only sets the default; the same pavilion gets
  // booked both ways without reconfiguring it.
  const defaultBillable =
    (selectedLocation?.reservation_visibility ??
      selectedAsset?.reservation_visibility) === "public";
  const billingType = billingChoice ?? (defaultBillable ? "billable" : "non_billable");
  const billable = billingType === "billable";

  const submit = async () => {
    if (!targetId || !checkin) return;
    setError(null);
    setSaving(true);

    const start = new Date(checkin).getTime();
    const end = checkout ? new Date(checkout).getTime() : start + 24 * 3600_000;

    // Overlap guard (MarinaSettings.allowOverlappingReservations, default off):
    // blocked outright with the conflicting reservation named. Re-read at
    // submit rather than trusting the rendered list, which may be minutes old.
    if (!allowOverlap && targetKind) {
      const conflict = await findConflict(targetKind, targetId, start, end);
      if (conflict) {
        setError(
          `Conflicts with the existing reservation for ${
            conflict.contact_name ?? "an unnamed contact"
          } (${new Date(conflict.expected_checkin!).toLocaleDateString()}${
            conflict.expected_checkout
              ? ` – ${new Date(conflict.expected_checkout).toLocaleDateString()}`
              : ""
          }).`,
        );
        setSaving(false);
        return;
      }
    }

    let contact = contactId;
    if (creatingContact && newContact.name.trim()) {
      contact = await createContact(
        {
          name: newContact.name.trim(),
          phone: newContact.phone.trim() || null,
          email: newContact.email.trim() || null,
        },
        current.user?.id ?? null,
      );
    }

    const targetName =
      selectedLocation?.name ?? selectedAsset?.name ?? "a reservable target";
    const reservationId = await createReservation(
      {
        status: confirmed ? "confirmed" : "requested",
        contactId: contact || null,
        locationId: targetKind === "location" ? targetId : null,
        assetId: targetKind === "asset" ? targetId : null,
        billingType,
        expectedCheckin: new Date(start).toISOString(),
        expectedCheckout: checkout ? new Date(end).toISOString() : null,
        rate: billable && rate !== "" ? Number(rate) : null,
        deposit: billable && deposit !== "" ? Number(deposit) : null,
      },
      targetName,
      current.user?.id ?? null,
    );
    navigate(`/reservations/${reservationId}`, { replace: true });
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="page-head">
        <h1 className="page-title">New Reservation</h1>
      </div>

      <div className="field">
        <span className="field-label">Location — reservable only</span>
        {/* Path-aware search: "Slip 14" exists on every dock, so the
            ancestor path is what disambiguates. */}
        <LocationPicker
          locations={locations}
          value={targetKind === "location" ? (targetId ?? "") : ""}
          onChange={(locationId) =>
            setTargetKey(locationId ? `location:${locationId}` : "")
          }
          allowNone={false}
          placeholder="Search reservable locations…"
        />
      </div>

      <div className="field">
        <span className="field-label">…or a reservable asset</span>
        <select
          className="select"
          value={targetKind === "asset" ? targetKey : ""}
          onChange={(e) => setTargetKey(e.target.value)}
        >
          <option value="">Select an asset…</option>
          {assets.map((a) => (
            <option key={a.id} value={`asset:${a.id}`}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <span className="field-label">Reservation type</span>
        <select
          className="select select-inline"
          value={billingType}
          onChange={(e) =>
            setBillingChoice(e.target.value as "billable" | "non_billable")
          }
        >
          <option value="billable">Billable</option>
          <option value="non_billable">Non-Billable</option>
        </select>
        {targetKey && billingChoice === null && (
          <span className="muted small">
            {" "}
            default for this target
          </span>
        )}
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

      {billable && (
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
