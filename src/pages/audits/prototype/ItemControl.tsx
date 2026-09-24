// PROTOTYPE — throwaway. One item's control, the same markup the Finding
// form uses. Shared by every variant on purpose: the question under test is
// the *stepping*, not the field.
//
// Answering moves focus to the next logical field rather than always to the
// next item (owner, 2026-09-23): a Service answered Present reveals its
// working box and note and focuses the note, so the auditor can type one or
// press Next to skip it; answers with nothing to follow move straight on.
import { useRef, type CSSProperties } from "react";
import { useNoteSuggestions } from "../../../data/services";
import type { AmenityAnswer, AttributeAnswer, AnswerValue, ServiceAnswer, WizardItem } from "./wizardModel";

export function ItemControl({
  item,
  value,
  statuses,
  onChange,
  big,
  advance,
  autoFocus,
}: {
  item: WizardItem;
  value: AnswerValue | undefined;
  statuses: { id: string; name: string }[];
  onChange: (v: AnswerValue) => void;
  /** One-item-per-screen variants render the control larger. */
  big?: boolean;
  /** Move to the next item. */
  advance?: () => void;
  /** The field the page focuses when it lands on this item. */
  autoFocus?: boolean;
}) {
  const cls = big ? "wz-big" : "";
  const onward = () => advance?.();
  // The note input mounts only once an answer reveals it, so focusing it is
  // a callback ref that fires on mount, not a call into the past.
  const noteRef = useRef<HTMLInputElement | null>(null);
  const wantNote = useRef(false);
  const attachNote = (el: HTMLInputElement | null) => {
    noteRef.current = el;
    if (el && wantNote.current) {
      wantNote.current = false;
      el.focus();
    }
  };
  const focusNote = () => {
    if (noteRef.current) noteRef.current.focus();
    else wantNote.current = true;
  };

  switch (item.kind) {
    case "service": {
      const v = (value as ServiceAnswer) ?? { present: null, working: true, note: "" };
      return (
        <div className={`wz-control ${cls}`}>
          <YesNo
            value={v.present}
            labels={["Present", "Absent"]}
            big={big}
            onChange={(present) => {
              onChange({ ...v, present });
              if (present) focusNote();
              else onward();
            }}
          />
          {v.present === true && (
            <>
              <label className="muted small wz-inline">
                <input
                  type="checkbox"
                  checked={v.working}
                  onChange={(e) => {
                    onChange({ ...v, working: e.target.checked });
                    focusNote();
                  }}
                />{" "}
                working
              </label>
              <NoteField
                kind="service"
                entryId={item.entryId}
                value={v.note}
                inputRef={attachNote}
                onChange={(note) => onChange({ ...v, note })}
                onEnter={onward}
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
          <YesNo
            value={v.present}
            labels={["Present", "Absent"]}
            big={big}
            onChange={(present) => {
              onChange({ ...v, present });
              if (present) focusNote();
              else onward();
            }}
          />
          {v.present === true && (
            <NoteField
              kind="amenity"
              entryId={item.entryId}
              value={v.note}
              inputRef={attachNote}
              onChange={(note) => onChange({ ...v, note })}
              onEnter={onward}
            />
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
                <button
                  key={c}
                  type="button"
                  className={`chip ${big ? "wz-chip-big" : ""} ${v.text === c ? "tree-match" : ""}`}
                  onClick={() => {
                    onChange({ ...v, text: c, value: "" });
                    focusNote();
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          ) : (
            <>
              <NumberField
                className={`input ${big ? "wz-input-big" : "select-inline"}`}
                placeholder="none"
                style={big ? undefined : { width: 100 }}
                value={v.value}
                autoFocus={autoFocus}
                onChange={(next) => onChange({ ...v, value: next, text: "" })}
                onEnter={focusNote}
              />
              {item.unit && <span className="muted">{item.unit}</span>}
            </>
          )}
          <NoteField
            kind="attribute"
            entryId={item.entryId}
            value={v.note}
            inputRef={attachNote}
            onChange={(note) => onChange({ ...v, note })}
            onEnter={onward}
          />
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
              onChange={(v) => {
                onChange(v);
                onward();
              }}
            />
          </div>
        );
      if (item.questionKind === "choice")
        return (
          <div className={`wz-control ${cls}`}>
            <div className="chip-row" style={{ marginBottom: 0 }}>
              {(item.choices ?? []).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`chip ${big ? "wz-chip-big" : ""} ${value === c ? "tree-match" : ""}`}
                  onClick={() => {
                    onChange(c);
                    onward();
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        );
      if (item.questionKind === "meter_reading")
        return (
          <div className={`wz-control ${cls}`}>
            <NumberField
              className={`input ${big ? "wz-input-big" : "select-inline"}`}
              value={typeof value === "number" ? String(value) : ""}
              autoFocus={autoFocus}
              onChange={(next) => onChange(next === "" ? null : Number(next))}
              onEnter={onward}
            />
          </div>
        );
      return (
        <div className={`wz-control ${cls}`}>
          <TextField
            className={`input ${big ? "wz-input-big" : ""}`}
            value={typeof value === "string" ? value : ""}
            autoFocus={autoFocus}
            onChange={(next) => onChange(next)}
            onEnter={onward}
          />
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
            onChange={(v) => {
              onChange(v);
              onward();
            }}
          />
          {item.kind === "map" && <span className="muted small wz-inline">the map would be shown here</span>}
        </div>
      );
    case "status":
      return (
        <div className={`wz-control ${cls}`}>
          <div className="chip-row" style={{ marginBottom: 0 }}>
            {statuses.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`chip ${big ? "wz-chip-big" : ""} ${value === s.id ? "tree-match" : ""}`}
                onClick={() => {
                  onChange(s.id);
                  onward();
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
      );
    case "gps":
      return (
        <div className={`wz-control ${cls}`}>
          <button
            type="button"
            className={`btn ${big ? "btn-primary wz-btn-big" : "btn-sm"}`}
            onClick={() => {
              onChange("captured");
              onward();
            }}
          >
            {value === "captured" ? "✓ Captured" : "Use my position"}
          </button>
          <span className="muted small wz-inline">the real block checks accuracy first</span>
        </div>
      );
    default:
      return null;
  }
}

/** A note, with the suggestions the Finding form offers - the distinct
 *  notes already recorded for this entry, most-used first. Next moves on. */
function NoteField({
  kind,
  entryId,
  value,
  inputRef,
  onChange,
  onEnter,
}: {
  kind: "service" | "amenity" | "attribute";
  entryId: string | null;
  value: string;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (v: string) => void;
  onEnter: () => void;
}) {
  const suggestions = useNoteSuggestions(kind, entryId ?? undefined);
  const listId = `wz-notes-${kind}-${entryId}`;
  return (
    <form
      className="wz-field-form"
      onSubmit={(e) => {
        e.preventDefault();
        onEnter();
      }}
    >
      <input
        className="input wz-note"
        ref={inputRef}
        list={listId}
        placeholder="note (optional)"
        enterKeyHint="next"
        value={value}
        data-testid="wz-note"
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </form>
  );
}

/** Enter (or the phone keyboard's Next) moves on, so a numeric answer is
 *  type-type-next without reaching for the screen. */
function NumberField({
  className,
  value,
  placeholder,
  style,
  autoFocus,
  onChange,
  onEnter,
}: {
  className: string;
  value: string;
  placeholder?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
  onChange: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <form
      className="wz-field-form"
      onSubmit={(e) => {
        e.preventDefault();
        onEnter();
      }}
    >
      <input
        className={className}
        type="number"
        step="any"
        inputMode="decimal"
        enterKeyHint="next"
        placeholder={placeholder}
        style={style}
        value={value}
        data-autofocus={autoFocus ? "" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </form>
  );
}

function TextField({
  className,
  value,
  placeholder,
  autoFocus,
  onChange,
  onEnter,
}: {
  className: string;
  value: string;
  placeholder?: string;
  autoFocus?: boolean;
  onChange: (v: string) => void;
  onEnter: () => void;
}) {
  return (
    <form
      className="wz-field-form"
      onSubmit={(e) => {
        e.preventDefault();
        onEnter();
      }}
    >
      <input
        className={className}
        enterKeyHint="next"
        placeholder={placeholder}
        value={value}
        data-autofocus={autoFocus ? "" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
    </form>
  );
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
