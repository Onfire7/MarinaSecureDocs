import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * The options of anything a person picks from: an Audit Question of kind
 * Choice ("Is this RV site back-in or pull-through?") and a choice
 * Attribute ("Site type"), which are the same list with the same rules.
 *
 * One row per option, add and remove — not a comma-separated field, which
 * had nowhere to put an option that itself contains a comma and doesn't
 * read as a way to add anything.
 */
export function ChoiceOptionsEditor({
  choices,
  onChange,
  emptyMessage,
}: {
  choices: string[];
  onChange: (choices: string[]) => void;
  emptyMessage?: string;
}) {
  const { t } = useTranslation("shared");
  const [draft, setDraft] = useState("");
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...choices, value]);
    setDraft("");
  };
  return (
    <div className="stack" style={{ gap: 4, marginTop: 4 }}>
      {choices.map((c, i) => (
        <div key={i} className="row" style={{ gap: 6, alignItems: "center" }}>
          <input
            className="input"
            value={c}
            onChange={(e) => onChange(choices.map((x, j) => (j === i ? e.target.value : x)))}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn btn-sm btn-bare"
            aria-label={t("choices.remove")}
            onClick={() => onChange(choices.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="row" style={{ gap: 6 }}>
        <input
          className="input"
          value={draft}
          placeholder={t("choices.placeholder")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn btn-sm" onClick={add} disabled={!draft.trim()}>
          {t("choices.add")}
        </button>
      </div>
      {choices.length === 0 && <span className="muted small">{emptyMessage ?? t("choices.empty")}</span>}
    </div>
  );
}
