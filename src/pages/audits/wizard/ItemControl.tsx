// One item's control inside the wizard, the same markup the Finding form
// uses (AuditWizardPage.spec.md).
//
// Answering moves focus to the next logical field rather than always to the
// next item (owner, 2026-09-23): a Service answered Present reveals its
// working box and note and focuses the note, so the auditor can type one or
// press Next to skip it; answers with nothing to follow move straight on.
import { useRef, useState, type CSSProperties } from "react";
import { useLocationMap, useMapFit } from "../../../data/maps";
import { placementOf } from "../../../data/locations";
import { MapLabelEditor } from "../../shared/MapLabelEditor";
import { MapPreview } from "../../shared/MapPreview";
import { useDevicePosition } from "../../shared/useDevicePosition";
import { useNoteSuggestions } from "../../../data/services";
import { useMarinaSettings } from "../../../data/settings";
import type { AmenityAnswer, AttributeAnswer, AnswerValue, GpsAnswer, MapAnswer, ServiceAnswer, WizardItem, WizardTarget } from "../../../lib/auditWizard";
import { GpsCapture } from "../GpsCapture";
import { PlacementCheck } from "../PlacementCheck";
import type { AnswerMode } from "./runProps";

export function ItemControl({
  item,
  target,
  value,
  statuses,
  onChange,
  big,
  advance,
  autoFocus,
}: {
  item: WizardItem;
  /** Whose item: the map and GPS pages need the location itself. */
  target: WizardTarget;
  value: AnswerValue | undefined;
  statuses: { id: string; name: string }[];
  /** `typing` while a field is being edited: the page holds the value and
   *  writes it when the field commits. A write per keystroke is ten
   *  overlapping transactions for one note, and the last to land wins -
   *  which is not the one the auditor typed. A `commit` that changed
   *  nothing is not written at all. */
  onChange: (v: AnswerValue, mode?: AnswerMode) => void;
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
                onChange={(note) => onChange({ ...v, note }, "typing")}
                onCommit={(note) => onChange({ ...v, note }, "commit")}
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
              onChange={(note) => onChange({ ...v, note }, "typing")}
              onCommit={(note) => onChange({ ...v, note }, "commit")}
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
                onChange={(next) => onChange({ ...v, value: next, text: "" }, "typing")}
                onCommit={(next) => onChange({ ...v, value: next, text: "" }, "commit")}
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
            onChange={(note) => onChange({ ...v, note }, "typing")}
            onCommit={(note) => onChange({ ...v, note }, "commit")}
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
              onChange={(next) => onChange(next === "" ? null : Number(next), "typing")}
              onCommit={(next) => onChange(next === "" ? null : Number(next), "commit")}
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
            onChange={(next) => onChange(next, "typing")}
            onCommit={(next) => onChange(next, "commit")}
            onEnter={onward}
          />
        </div>
      );
    }
    case "marked":
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
        </div>
      );
    case "map":
      return <MapControl target={target} value={value} big={big} onChange={onChange} onward={onward} />;
    case "gps":
      return <GpsControl target={target} value={value} big={big} onChange={onChange} />;
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
  onCommit,
  onEnter,
}: {
  kind: "service" | "amenity" | "attribute";
  entryId: string | null;
  value: string;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (v: string) => void;
  /** Handed the field's current value: a commit fired before React has
   *  re-rendered would otherwise write the value as of the last keystroke
   *  but one. */
  onCommit: (current: string) => void;
  onEnter: () => void;
}) {
  const suggestions = useNoteSuggestions(kind, entryId ?? undefined);
  const listId = `wz-notes-${kind}-${entryId}`;
  return (
    <>
      <input
        className="input wz-note"
        ref={inputRef}
        list={listId}
        placeholder="note (optional)"
        enterKeyHint="next"
        value={value}
        data-testid="wz-note"
        onBlur={(e) => onCommit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          onCommit(e.currentTarget.value);
          onEnter();
        }}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
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
  onCommit,
  onEnter,
}: {
  className: string;
  value: string;
  placeholder?: string;
  style?: CSSProperties;
  autoFocus?: boolean;
  onChange: (v: string) => void;
  /** Handed the field's current value: a commit fired before React has
   *  re-rendered would otherwise write the value as of the last keystroke
   *  but one. */
  onCommit: (current: string) => void;
  onEnter: () => void;
}) {
  return (
    <>
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
        onBlur={(e) => onCommit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          onCommit(e.currentTarget.value);
          onEnter();
        }}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  );
}

function TextField({
  className,
  value,
  placeholder,
  autoFocus,
  onChange,
  onCommit,
  onEnter,
}: {
  className: string;
  value: string;
  placeholder?: string;
  autoFocus?: boolean;
  onChange: (v: string) => void;
  /** Handed the field's current value: a commit fired before React has
   *  re-rendered would otherwise write the value as of the last keystroke
   *  but one. */
  onCommit: (current: string) => void;
  onEnter: () => void;
}) {
  return (
    <>
      <input
        className={className}
        enterKeyHint="next"
        placeholder={placeholder}
        value={value}
        data-autofocus={autoFocus ? "" : undefined}
        onBlur={(e) => onCommit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          onCommit(e.currentTarget.value);
          onEnter();
        }}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
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

/** "Placed correctly on the map?" with the map in front of the person
 *  answering, the same check the Finding form uses: the map on top, the
 *  question under it - and no question at all when the location is not on
 *  the map yet, just *Place it on the map*. Yes moves on; No opens the
 *  editor, because No is answered by moving it. */
function MapControl({
  target,
  value,
  big,
  onChange,
  onward,
}: {
  target: WizardTarget;
  value: AnswerValue | undefined;
  big?: boolean;
  onChange: (v: AnswerValue, mode?: AnswerMode) => void;
  onward: () => void;
}) {
  const v: MapAnswer = typeof value === "boolean" ? { correct: value, placement: null } : ((value as MapAnswer | undefined) ?? { correct: null, placement: null });
  if (!target.location_id) return <span className="muted small">Not a location on file, so it has no place on the map yet.</span>;
  return (
    <div className={`wz-control ${big ? "wz-big" : ""} wz-map`}>
      <PlacementCheck
        locationId={target.location_id}
        locationName={target.location_name}
        editable
        big={big}
        proposed={v.placement as React.ComponentProps<typeof PlacementCheck>["proposed"]}
        onPropose={(p) => onChange({ ...v, placement: p ? { map_id: p.map_id, placement: { ...p.placement } } : null })}
        answer={v.correct}
        onAnswer={(correct) => {
          onChange({ ...v, correct });
          if (correct) onward();
        }}
      />
    </div>
  );
}

/** The GPS page: where the pin is, how far the device is from it, and the
 *  capture under the same rules as the Finding form. Shown pin or no pin.
 *  Capturing a fix opens the map in anchor mode - "tap where you are" -
 *  which ties the coordinates to the map (docs/maps.md); the anchor rides
 *  on the answer and becomes a move_placement Proposal. Cancelling keeps
 *  the fix and ties nothing. */
function GpsControl({
  target,
  value,
  big,
  onChange,
}: {
  target: WizardTarget;
  value: AnswerValue | undefined;
  big?: boolean;
  onChange: (v: AnswerValue, mode?: AnswerMode) => void;
}) {
  const settings = useMarinaSettings();
  const [anchoring, setAnchoring] = useState(false);
  const fix = value && typeof value === "object" && "lat" in value ? (value as GpsAnswer) : null;
  const { map, own, placements } = useLocationMap(target.location_id, fix?.anchor?.map_id ?? null);
  const fit = useMapFit(map?.id);
  const device = useDevicePosition();
  const ownShape = own ? placementOf(own) : null;
  const shape = fix?.anchor && map && fix.anchor.map_id === map.id ? { ...(ownShape ?? { rotation: 0 }), cx: fix.anchor.cx, cy: fix.anchor.cy } : ownShape;
  const pinned = target.gps_lat !== null && target.gps_lng !== null;
  // What the map can say about this page: where you are, where the pin on
  // file is, where the fix just captured is - each only when the fit can
  // place it (owner, 2026-10-05).
  const marks = [
    ...(pinned ? [{ lat: target.gps_lat!, lng: target.gps_lng!, kind: "pin" as const, title: `${target.location_name}, as pinned` }] : []),
    ...(fix ? [{ lat: fix.lat, lng: fix.lng, kind: "fix" as const, title: "The fix just captured" }] : []),
  ];
  return (
    <div className={`wz-control ${big ? "wz-big" : ""}`}>
      <GpsCapture
        locationName={target.location_name}
        pin={target.gps_lat !== null && target.gps_lng !== null ? { lat: target.gps_lat, lng: target.gps_lng } : null}
        radius={settings.auditGpsRadius}
        accuracyLimit={settings.auditGpsAccuracy}
        captured={fix}
        editable
        always
        big={big}
        onCapture={(f) => {
          onChange(f);
          if (f && map && target.location_id) setAnchoring(true);
        }}
      />
      {map && target.location_id && (
        <MapPreview
          map={map}
          placements={placements}
          subject={{ locationId: target.location_id, name: target.location_name }}
          shape={shape}
          proposed={!!fix?.anchor}
          fit={fit}
          device={device}
          marks={marks}
          onOpen={fix ? () => setAnchoring(true) : undefined}
          testId="gps-map"
        />
      )}
      {fix && map && target.location_id && (
        <div className="muted small" style={{ textAlign: "center" }}>
          {fix.anchor ? "Tied to the map." : "Not tied to the map yet."}{" "}
          <button type="button" className="btn btn-sm" data-testid="gps-anchor" onClick={() => setAnchoring(true)}>
            {fix.anchor ? "Move where I am" : "Tap where I am on the map"}
          </button>
        </div>
      )}
      {anchoring && fix && map && target.location_id && (
        <MapLabelEditor
          map={map}
          placements={placements}
          subject={{ locationId: target.location_id, name: target.location_name }}
          shape={shape}
          mode="anchor"
          fit={fit}
          onCancel={() => setAnchoring(false)}
          onDone={(next) => {
            setAnchoring(false);
            onChange({ ...fix, anchor: next ? { map_id: map.id, cx: next.cx, cy: next.cy } : null });
          }}
        />
      )}
    </div>
  );
}
