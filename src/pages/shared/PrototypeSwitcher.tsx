import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";

// PROTOTYPE — throwaway. Floating variant switcher for UI prototypes.
// Reads/writes ?variant=; ← → cycle unless a text field is focused. Never
// rendered in production builds.
export function PrototypeSwitcher({
  variants,
}: {
  variants: { key: string; name: string }[];
}) {
  const [params, setParams] = useSearchParams();
  const current = params.get("variant") ?? variants[0].key;
  const idx = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );
  const go = (delta: number) => {
    const next = variants[(idx + delta + variants.length) % variants.length];
    const p = new URLSearchParams(params);
    p.set("variant", next.key);
    setParams(p, { replace: true });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  if (import.meta.env.PROD) return null;
  return (
    <div
      style={{
        position: "fixed",
        // Top-centre: the wizard owns the bottom bar.
        top: 6,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: "#111",
        color: "#fff",
        borderRadius: 999,
        padding: "6px 10px",
        display: "flex",
        gap: 10,
        alignItems: "center",
        boxShadow: "0 4px 16px rgba(0,0,0,.4)",
        fontSize: 13,
        fontFamily: "monospace",
      }}
    >
      <button onClick={() => go(-1)} style={{ color: "#fff", background: "none", border: 0 }}>
        ←
      </button>
      <span>
        {variants[idx].key} — {variants[idx].name}
      </span>
      <button onClick={() => go(1)} style={{ color: "#fff", background: "none", border: 0 }}>
        →
      </button>
    </div>
  );
}
