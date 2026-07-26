import { useState } from "react";
import { db, id } from "../../lib/db";
import { useCurrent } from "../../lib/auth/CurrentUserContext";
import { statusLabel } from "../../lib/locations";
import { DEFAULT_POST_RETURN_STATUS } from "../../lib/assets";
import { displayName } from "../../lib/contacts";

// Assets — Checkout / Return Dialog (see docs/pages/asset-checkout-dialog.html).
// One dialog, two modes: an asset with an open checkout can only be returned,
// never checked out again. Checkout deliberately writes no status entry;
// only return has a modeled status effect (post_return_status).
export function CheckoutDialog({
  asset,
  openCheckout,
  onClose,
}: {
  asset: { id: string; name: string; postReturnStatus?: string | null };
  openCheckout: { id: string; timeOut: string | number } | undefined;
  onClose: () => void;
}) {
  const current = useCurrent();
  const mode = openCheckout ? "return" : "checkout";
  const [personId, setPersonId] = useState(current.user?.contact?.id ?? "");
  const [when, setWhen] = useState(() => localDateTime(new Date()));

  const { data } = db.useQuery({ contacts: { mergedInto: {} } });
  const contacts = [...(data?.contacts ?? [])]
    .filter((c) => !c.mergedInto)
    .sort((a, b) => displayName(a).localeCompare(displayName(b)));

  const submit = async () => {
    const ts = new Date(when).getTime();
    if (mode === "checkout") {
      await db.transact(
        db.tx.assetCheckouts[id()]
          .update({ timeOut: ts })
          .link({
            asset: asset.id,
            ...(current.user ? { checkedOutBy: current.user.id } : {}),
            ...(personId ? { person: personId } : {}),
          }),
      );
    } else {
      const postStatus = asset.postReturnStatus ?? DEFAULT_POST_RETURN_STATUS;
      await db.transact([
        db.tx.assetCheckouts[openCheckout!.id].update({ timeIn: ts }),
        db.tx.assets[asset.id].update({ currentStatus: postStatus }),
        db.tx.assetStatusLogs[id()]
          .update({ status: postStatus, timestamp: ts, note: "Returned from checkout" })
          .link({
            asset: asset.id,
            ...(current.user ? { loggedBy: current.user.id } : {}),
          }),
      ]);
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
            Out since {new Date(openCheckout!.timeOut).toLocaleString()}.
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
            {asset.name} will be marked{" "}
            {statusLabel(asset.postReturnStatus ?? DEFAULT_POST_RETURN_STATUS)}.
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
