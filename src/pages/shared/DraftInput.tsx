import { useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";

/**
 * A text field whose value the user owns while they're typing in it.
 *
 * Every inline editor in Admin used to write to InstantDB on each keystroke
 * and take its `value` straight back from `useQuery`. That round-trip is
 * asynchronous, so React re-rendered mid-word with the *previous* stored
 * value: the caret jumped to the end, and on mobile the IME — which composes
 * against the DOM value it last saw — reinserted what it thought was still
 * pending, duplicating text after the caret. Deleting was worst, because the
 * echo restored the character just removed.
 *
 * The rule that fixes it: while the field has focus, the local draft is the
 * single source of truth and incoming values are ignored. External edits are
 * adopted on blur, so a co-admin's change still lands — just not underneath
 * someone's cursor.
 *
 * Writes are debounced during typing and flushed on blur and on unmount, so
 * closing a card or navigating away can't lose the last keystrokes.
 */
export function useDraft(
  canonical: string,
  commit: (next: string) => void,
  debounceMs = 500,
) {
  const [draft, setDraft] = useState(canonical);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Refs so the unmount flush reads current values without re-subscribing.
  const pending = useRef<string | null>(null);
  // An external value that arrived while focused and was therefore not
  // adopted; applied on blur if the user made no edits of their own.
  const missed = useRef<string | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    if (focused.current) {
      missed.current = canonical;
    } else {
      setDraft(canonical);
      missed.current = null;
    }
  }, [canonical]);

  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current != null) {
      commitRef.current(pending.current);
      pending.current = null;
    }
  };

  // Flush on unmount — collapsing a card unmounts the field, and those
  // keystrokes are still the user's work.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current != null) commitRef.current(pending.current);
    },
    [],
  );

  const onChange = (next: string) => {
    setDraft(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, debounceMs);
  };

  return {
    value: draft,
    onChange,
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      // Order matters: a local edit wins, and re-syncing to `canonical` here
      // would show the pre-write value until the transaction echoed back.
      const hadLocalEdit = pending.current != null;
      flush();
      if (!hadLocalEdit && missed.current != null) setDraft(missed.current);
      missed.current = null;
    },
    /** Enter commits, Escape abandons the draft. */
    onKeyDown: (key: string) => {
      if (key === "Enter") flush();
      if (key === "Escape") {
        if (timer.current) clearTimeout(timer.current);
        pending.current = null;
        setDraft(canonical);
      }
    },
  };
}

type DraftInputProps = Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "onBlur" | "onFocus" | "onKeyDown"
> & {
  value: string;
  onCommit: (next: string) => void;
  debounceMs?: number;
  /** Enter also blurs — right for single-line names, wrong for a form field. */
  blurOnEnter?: boolean;
};

export function DraftInput({
  value,
  onCommit,
  debounceMs,
  blurOnEnter = false,
  ...rest
}: DraftInputProps) {
  const d = useDraft(value, onCommit, debounceMs);
  return (
    <input
      {...rest}
      value={d.value}
      onChange={(e) => d.onChange(e.target.value)}
      onFocus={d.onFocus}
      onBlur={d.onBlur}
      onKeyDown={(e) => {
        d.onKeyDown(e.key);
        if (e.key === "Enter" && blurOnEnter) e.currentTarget.blur();
      }}
    />
  );
}

type DraftTextareaProps = Omit<
  ComponentProps<"textarea">,
  "value" | "onChange" | "onBlur" | "onFocus" | "onKeyDown"
> & {
  value: string;
  onCommit: (next: string) => void;
  debounceMs?: number;
};

export function DraftTextarea({
  value,
  onCommit,
  debounceMs,
  ...rest
}: DraftTextareaProps) {
  const d = useDraft(value, onCommit, debounceMs);
  return (
    <textarea
      {...rest}
      value={d.value}
      onChange={(e) => d.onChange(e.target.value)}
      onFocus={d.onFocus}
      onBlur={d.onBlur}
      // Enter is a newline here, so only Escape is special.
      onKeyDown={(e) => {
        if (e.key === "Escape") d.onKeyDown("Escape");
      }}
    />
  );
}

/**
 * Number variant. Keeps the raw string locally so a half-typed "-" or "" is
 * editable, and only reports parsed values — `undefined` when cleared, which
 * is how the schema spells "fall back to the marina default".
 */
export function DraftNumberInput({
  value,
  onCommit,
  debounceMs,
  ...rest
}: Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "onBlur" | "onFocus" | "onKeyDown" | "type"
> & {
  value: number | null | undefined;
  onCommit: (next: number | undefined) => void;
  debounceMs?: number;
}) {
  const d = useDraft(
    value == null ? "" : String(value),
    (next) => onCommit(next.trim() === "" ? undefined : Number(next)),
    debounceMs,
  );
  return (
    <input
      {...rest}
      type="number"
      value={d.value}
      onChange={(e) => d.onChange(e.target.value)}
      onFocus={d.onFocus}
      onBlur={d.onBlur}
      onKeyDown={(e) => d.onKeyDown(e.key)}
    />
  );
}
