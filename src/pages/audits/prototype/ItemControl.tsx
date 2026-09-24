// PROTOTYPE — throwaway. One item's control, the same markup the Finding
// form uses. Shared by every variant on purpose: the question under test is
// the *stepping*, not the field.
import type { AmenityAnswer, AttributeAnswer, AnswerValue, ServiceAnswer, WizardItem } from "./wizardModel";

export function ItemControl({
  item,
  value,
  statuses,
  onChange,
  big,
}: {
  item: WizardItem;
  value: AnswerValue | undefined;
  statuses: { id: string; name: string }[];
  onChange: (v: AnswerValue) => void;
  /** One-item-per-screen variants render the control larger. */
  big?: boolean;
}) {
  const cls = big ? "wz-big" : "";
  switch (item.kind) {
    case "service": {
      const v = (value as ServiceAnswer) ?? { present: null, working: true, note: "" };
      return (
        <div className={`wz-control ${cls}`}>
          <YesNo
            value={v.present}
            labels={["Present", "Absent"]}
            big={big}
            onChange={(present) => onChange({ ...v, present })}
          />
          {v.present === true && (
            <>
              <label className="muted small wz-inline">
                <input type="checkbox" checked={v.working} onChange={(e) => onChange({ ...v, working: e.target.checked })} /> working
              </label>
              <input
                className="input wz-note"
                placeholder="note"
                value={v.note}
                onChange={(e) => onChange({ ...v, note: e.target.value })}
              />
            </>
          )}
        </div>
      );
    }
    case "amenity": {
      const v = (value as AmenityAnswer) ?? { present: null, note: "" };
      return (
        <div className={`wz-control ${cls}`}>
          <YesNo value={v.present} labels={["Present", "Absent"]} big={big} onChange={(present) => onChange({ ...v, present })} />
          {v.present === true && (
            <input className="input wz-note" placeholder="note" value={v.note} onChange={(e) => onChange({ ...v, note: e.target.value })} />
          )}
        </div>
      );
    }
    case "attribute": {
      const v = (value as AttributeAnswer) ?? { value: "", text: "", note: "" };
      return (
        <div className={`wz-control ${cls}`}>
          {item.choices && item.choices.length > 0 ? (
            <div className="chip-row" style={{ marginBottom: 0 }}>
              {item.choices.map((c) => (
                <button key={c} type="button" className={`chip ${big ? "wz-chip-big" : ""} ${v.text === c ? "tree-match" : ""}`} onClick={() => onChange({ ...v, text: c, value: "" })}>
                  {c}
                </button>
              ))}
            </div>
          ) : (
            <>
              <input
                className={`input ${big ? "wz-input-big" : "select-inline"}`}
                type="number"
                step="any"
                placeholder="none"
                style={big ? undefined : { width: 100 }}
                value={v.value}
                onChange={(e) => onChange({ ...v, value: e.target.value, text: "" })}
              />
              {item.unit && <span className="muted">{item.unit}</span>}
            </>
          )}
          <input className="input wz-note" placeholder="note" value={v.note} onChange={(e) => onChange({ ...v, note: e.target.value })} />
        </div>
      );
    }
    case "question": {
      if (item.questionKind === "yes_no")
        return (
          <div className={`wz-control ${cls}`}>
            <YesNo
              value={typeof value === "boolean" ? value : null}
              labels={["Yes", item.ticketOnNo ? "No (raises a ticket)" : "No"]}
              big={big}
              onChange={(v) => onChange(v)}
            />
          </div>
        );
      if (item.questionKind === "choice")
        return (
          <div className={`wz-control ${cls}`}>
            <div className="chip-row" style={{ marginBottom: 0 }}>
              {(item.choices ?? []).map((c) => (
                <button key={c} type="button" className={`chip ${big ? "wz-chip-big" : ""} ${value === c ? "tree-match" : ""}`} onClick={() => onChange(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        );
      if (item.questionKind === "meter_reading")
        return (
          <div className={`wz-control ${cls}`}>
            <input
              className={`input ${big ? "wz-input-big" : "select-inline"}`}
              type="number"
              step="any"
              value={typeof value === "number" ? value : ""}
              onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
            />
          </div>
        );
      return (
        <div className={`wz-control ${cls}`}>
          <input className={`input ${big ? "wz-input-big" : ""}`} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    }
    case "marked":
    case "map":
    case "occupied":
      return (
        <div className={`wz-control ${cls}`}>
          <YesNo
            value={typeof value === "boolean" ? value : null}
            labels={item.kind === "occupied" ? ["Occupied", "Vacant"] : ["Yes", "No"]}
            big={big}
            onChange={(v) => onChange(v)}
          />
          {item.kind === "map" && <span className="muted small wz-inline">the map would be shown here</span>}
        </div>
      );
    case "status":
      return (
        <div className={`wz-control ${cls}`}>
          <div className="chip-row" style={{ marginBottom: 0 }}>
            {statuses.map((s) => (
              <button key={s.id} type="button" className={`chip ${big ? "wz-chip-big" : ""} ${value === s.id ? "tree-match" : ""}`} onClick={() => onChange(s.id)}>
                {s.name}
              </button>
            ))}
          </div>
        </div>
      );
    case "gps":
      return (
        <div className={`wz-control ${cls}`}>
          <button type="button" className={`btn ${big ? "btn-primary wz-btn-big" : "btn-sm"}`} onClick={() => onChange("captured")}>
            {value === "captured" ? "✓ Captured" : "Use my position"}
          </button>
          <span className="muted small wz-inline">the real block checks accuracy first</span>
        </div>
      );
    default:
      return null;
  }
}

function YesNo({
  value,
  labels,
  big,
  onChange,
}: {
  value: boolean | null;
  labels: [string, string];
  big?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="chip-row" style={{ marginBottom: 0 }}>
      <button type="button" className={`chip ${big ? "wz-chip-big" : ""} ${value === true ? "tree-match" : ""}`} onClick={() => onChange(true)}>
        {labels[0]}
      </button>
      <button type="button" className={`chip ${big ? "wz-chip-big" : ""} ${value === false ? "tree-match" : ""}`} onClick={() => onChange(false)}>
        {labels[1]}
      </button>
    </div>
  );
}
