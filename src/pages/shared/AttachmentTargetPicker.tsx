import { useState } from "react";
import { db } from "../../lib/db";
import {
  TARGET_TYPES,
  type AttachmentTarget,
  type TargetType,
} from "../../lib/attachments";

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

  const { data } = db.useQuery(
    type === "location"
      ? { locations: {} }
      : type === "checkpoint"
        ? { checkpoints: {} }
        : type === "boat"
          ? { boats: {} }
          : type === "vehicle"
            ? { vehicles: {} }
            : type === "contact"
              ? { contacts: {} }
              : type === "asset"
                ? { assets: {} }
                : null,
  );

  const options: { id: string; label: string }[] = !type
    ? []
    : type === "vehicle"
      ? (data?.vehicles ?? []).map((v) => ({ id: v.id, label: v.description }))
      : type === "contact"
        ? (data?.contacts ?? []).map((c) => ({ id: c.id, label: c.name ?? "Unnamed contact" }))
        : (
            (data?.[
              type === "location"
                ? "locations"
                : type === "checkpoint"
                  ? "checkpoints"
                  : type === "boat"
                    ? "boats"
                    : "assets"
            ] ?? []) as { id: string; name: string }[]
          ).map((r) => ({ id: r.id, label: r.name }));

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
        {options
          .slice()
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
      </select>
    </div>
  );
}
