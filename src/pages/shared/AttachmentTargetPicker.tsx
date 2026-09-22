import { useState } from "react";
import {
  TARGET_TYPES,
  useAttachmentOptions,
  type AttachmentTarget,
  type TargetType,
} from "../../data/attachments";

// Shared attachment-target picker (see pages/attachment-target-picker.html):
// pick a target type, then a record of that type. Used by the new-ticket and
// new-incident forms whenever context didn't pre-fill the target.
export function AttachmentTargetPicker({
  value,
  onChange,
}: {
  value: AttachmentTarget | null;
  onChange: (target: AttachmentTarget | null) => void;
}) {
  const [type, setType] = useState<TargetType | "">(value?.type ?? "");

  // The label column differs per kind — a vehicle has a description where
  // everything else has a name — so each kind gets its own SELECT rather than
  // a query followed by six branches of mapping.
  const { data: options } = useAttachmentOptions(type);

  return (
    <div className="row" style={{ alignItems: "stretch" }}>
      <select
        className="select"
        style={{ flex: "0 0 40%" }}
        value={type}
        onChange={(e) => {
          setType(e.target.value as TargetType | "");
          onChange(null);
        }}
      >
        <option value="">Attach to…</option>
        {TARGET_TYPES.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </select>
      <select
        className="select"
        value={value?.id ?? ""}
        disabled={!type}
        onChange={(e) => {
          const opt = options.find((o) => o.id === e.target.value);
          onChange(opt && type ? { type, id: opt.id, label: opt.label } : null);
        }}
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
