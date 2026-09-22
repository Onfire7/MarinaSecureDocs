import { useState } from "react";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { DEFAULT_POST_RETURN_STATUS } from "../../lib/assets";
import { displayName } from "../../lib/contacts";
import { useContacts } from "../../data/contacts";
import {
  checkInAsset,
  checkOutAsset,
  type AssetRow,
  type CheckoutRow,
} from "../../data/assets";
import { resolveStatusByName, useAssetStatuses } from "../../data/lookups";

// Assets — Checkout / Return Dialog (see docs/pages/asset-checkout-dialog.html).
// One dialog, two modes: an asset with an open checkout can only be returned,
// never checked out again. Checkout deliberately writes no status entry;
// only return has a modeled status effect (post_return_status).
export function CheckoutDialog({
  asset,
  openCheckout,
  onClose,
}: {
  asset: AssetRow;
  openCheckout: CheckoutRow | null;
  onClose: () => void;
}) {
  const current = useCurrent();
  const mode = openCheckout ? "return" : "checkout";
  // The signed-in user's own contact record, where they have one — most
  // checkouts are to the person standing there holding the radio.
  const [personId, setPersonId] = useState(current.user?.contact_id ?? "");
  const [when, setWhen] = useState(() => localDateTime(new Date()));

  const { data: allContacts } = useContacts();
  const { statuses } = useAssetStatuses();
  const contacts = allContacts
    .filter((c) => !c.merged_into_id)
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));

  // Where the asset lands on return: its own post-return status if set,
  // otherwise whichever of the marina's statuses is called "Available". A
  // marina that has neither gets a return with no status change, which is
  // better than inventing a status row that does not exist.
  const postReturnStatus =
    statuses.find((st) => st.id === asset.post_return_status_id) ??
    resolveStatusByName(statuses, DEFAULT_POST_RETURN_STATUS);

  const submit = async () => {
    const actorId = current.user?.id ?? null;
    // `when` is the editable backfill time, not "now" — see the field below.
    const at = new Date(when);
    if (mode === "checkout") {
      const person = contacts.find((c) => c.id === personId);
      if (!person) return;
      await checkOutAsset(asset, person, at, actorId);
    } else {
      await checkInAsset(asset, openCheckout!.id, postReturnStatus, at, actorId);
    }
    onClose();
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          {mode === "checkout" ? "Check out" : "Return"} {asset.name}
        </div>

        {mode === "checkout" ? (
          <div className="field">
            <span className="field-label">Checking out to</span>
            <select
              className="select"
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              <option value="">Select a contact…</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {displayName(c)}
                </option>
              ))}
            </select>
            <p className="muted small" style={{ marginTop: 4 }}>
              Most checkouts go to someone who never signs into the app.
            </p>
          </div>
        ) : (
          <p className="muted small">
            Out since {new Date(openCheckout!.time_out).toLocaleString()}.
          </p>
        )}

        <div className="field">
          <span className="field-label">
            Time {mode === "checkout" ? "out" : "in"} (editable for backfill)
          </span>
          <input
            type="datetime-local"
            className="input"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
          />
        </div>

        {mode === "return" && (
          <p className="muted small">
            {postReturnStatus
              ? `${asset.name} will be marked ${postReturnStatus.name}.`
              : `${asset.name}'s status won't change — no post-return status is set.`}
          </p>
        )}

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={mode === "checkout" && !personId}
            onClick={() => void submit()}
          >
            {mode === "checkout" ? "Check out" : "Return"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function localDateTime(d: Date): string {
  const copy = new Date(d);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}
