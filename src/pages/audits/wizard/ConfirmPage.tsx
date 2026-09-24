// The page that ends a location (AuditWizardPage.spec.md § Confirming a
// location): everything this audit asks about the location, as it now
// stands, and the button that says it is done.
//
// It lists the WHOLE location, not the slice this run is sweeping - the
// point of it is to check the location before signing it off, and what an
// earlier pass recorded is exactly what wants checking. Rows the run has
// not touched are what is on file; rows it has are marked as such; rows
// with nothing behind them say so, so a gap is visible before the sign-off
// rather than afterwards on the audit page.
import { CONFIRM_KEY, type AnswerValue, type AttributeAnswer, type AmenityAnswer, type ServiceAnswer, type WizardItem, type WizardTarget } from "../../../lib/auditWizard";
import type { RunProps } from "./runProps";

export function ConfirmPage({ t, p, onDone }: { t: WizardTarget; p: RunProps; onDone?: () => void }) {
  const items = p.reviewItems(t).filter((i) => i.kind !== "confirm");
  const answers = p.answers[t.id];
  const confirmed = p.confirmedAt(t.id) !== null;
  const missing = items.filter((i) => shown(i, answers?.[i.key], t, p).missing).length;

  const set = (v: boolean) => {
    p.setAnswer(t.id, CONFIRM_KEY, v);
    if (v && onDone) onDone();
  };

  let group = "";
  return (
    <div className="wz-c-review" data-testid="wz-confirm">
      <div className="wz-c-review-list">
        {items.map((item) => {
          const head = item.group !== group ? item.group : null;
          group = item.group;
          const v = shown(item, answers?.[item.key], t, p);
          return (
            <div key={item.key}>
              {head && <div className="wz-c-review-group">{head}</div>}
              <div className={`wz-c-review-row ${v.missing ? "missing" : ""}`} data-testid="wz-review-row">
                <span className="wz-c-review-label">{item.label}</span>
                <span className="wz-c-review-value">{v.text}</span>
                {p.touched(t.id, item.key) && <span className="badge badge-good wz-c-review-tag">this run</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="wz-c-review-foot">
        <div className="muted small">
          {missing === 0
            ? `Everything this audit asks about ${t.location_name} has an answer.`
            : `${missing} of ${items.length} ${missing === 1 ? "item has" : "items have"} no answer yet.`}
        </div>
        {confirmed ? (
          <div className="row" style={{ gap: 10 }}>
            <span className="badge badge-good" data-testid="wz-confirmed">Audited</span>
            <button type="button" className="btn btn-sm" data-testid="wz-reopen" onClick={() => set(false)}>
              Reopen
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary" data-testid="wz-confirm-btn" onClick={() => set(true)}>
            Mark {t.location_name} audited
          </button>
        )}
      </div>
    </div>
  );
}

/** One review row's text, and whether it is a gap. Mirrors isAnswered() -
 *  what counts as answered is the model's business - and adds the words. */
function shown(item: WizardItem, v: AnswerValue | undefined, t: WizardTarget, p: RunProps): { text: string; missing: boolean } {
  const gap = { text: "not answered", missing: true };
  switch (item.kind) {
    case "service": {
      const s = v as ServiceAnswer | undefined;
      if (!s || s.present === null) return gap;
      if (!s.present) return { text: "absent", missing: false };
      return { text: `present, ${s.working ? "working" : "not working"}${s.note ? ` — ${s.note}` : ""}`, missing: false };
    }
    case "amenity": {
      const a = v as AmenityAnswer | undefined;
      if (!a || a.present === null) return gap;
      return { text: `${a.present ? "present" : "absent"}${a.note ? ` — ${a.note}` : ""}`, missing: false };
    }
    case "attribute": {
      const a = v as AttributeAnswer | undefined;
      const value = a?.value.trim() ? `${a.value}${item.unit ? ` ${item.unit}` : ""}` : a?.text.trim() ? a.text : "";
      if (!value) return gap;
      return { text: `${value}${a?.note ? ` — ${a.note}` : ""}`, missing: false };
    }
    case "question":
      if (v === undefined || v === null || v === "") return gap;
      return { text: typeof v === "boolean" ? (v ? "Yes" : "No") : String(v), missing: false };
    case "marked":
    case "map":
    case "occupied":
      if (typeof v !== "boolean") return gap;
      return { text: v ? "Yes" : "No", missing: false };
    case "status": {
      const name = typeof v === "string" ? p.statuses.find((s) => s.id === v)?.name : null;
      const text = name ?? t.status_name ?? "";
      return text ? { text, missing: false } : gap;
    }
    case "gps": {
      const fix = v as { lat: number; lng: number } | null | undefined;
      if (fix?.lat != null) return { text: `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`, missing: false };
      if (t.gps_lat !== null && t.gps_lng !== null) return { text: `${t.gps_lat.toFixed(5)}, ${t.gps_lng.toFixed(5)}`, missing: false };
      return gap;
    }
    default:
      return gap;
  }
}
