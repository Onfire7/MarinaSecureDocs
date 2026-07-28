import { useState } from "react";

/**
 * In-app replacement for `window.prompt`.
 *
 * Native prompts are silently suppressed in an installed PWA window, and in
 * Chrome once a user ticks "prevent this page from creating additional
 * dialogs" — the call just returns null, so the action it was gating appears
 * to do nothing at all. That's how adding a checklist item looked broken:
 * pick a type, get no item, no error, no clue. Since the app is installable,
 * every naming flow needs a dialog the page actually owns.
 *
 * Usage mirrors what it replaces, so call sites stay one-liners:
 *
 *   const [askText, promptNode] = useTextPrompt();
 *   const name = await askText("New tour name:");
 *   if (!name?.trim()) return;
 *   …
 *   return (<>{promptNode}…</>);
 */
export function useTextPrompt() {
  const [pending, setPending] = useState<{
    title: string;
    initial: string;
    resolve: (value: string | null) => void;
  } | null>(null);

  const askText = (title: string, initial = "") =>
    new Promise<string | null>((resolve) => setPending({ title, initial, resolve }));

  const settle = (value: string | null) => {
    pending?.resolve(value);
    setPending(null);
  };

  const promptNode = pending ? (
    <TextPromptDialog
      title={pending.title}
      initial={pending.initial}
      onSubmit={(v) => settle(v)}
      onCancel={() => settle(null)}
    />
  ) : null;

  return [askText, promptNode] as const;
}

function TextPromptDialog({
  title,
  initial,
  onSubmit,
  onCancel,
}: {
  title: string;
  initial: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div className="dialog-card" onClick={(e) => e.stopPropagation()}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          {title}
        </div>
        <div className="field">
          <input
            className="input"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) onSubmit(value);
              if (e.key === "Escape") onCancel();
            }}
          />
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!value.trim()}
            onClick={() => onSubmit(value)}
          >
            OK
          </button>
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
