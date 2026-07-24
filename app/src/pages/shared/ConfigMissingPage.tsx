interface Props {
  missing: string[];
}

// Shown instead of the app when required per-marina environment configuration
// is absent — each marina deployment supplies its own InstantDB app and Clerk
// application (see docs: Stack & Architecture — Per-marina isolation).
export function ConfigMissingPage({ missing }: Props) {
  return (
    <div className="config-missing">
      <h1 style={{ marginBottom: 8 }}>Marina not configured</h1>
      <p className="muted">
        This build has no marina environment attached. Copy{" "}
        <code>.env.example</code> to <code>.env.local</code> and fill in this
        marina's values:
      </p>
      <pre>
        {missing.map((k) => `${k}=…`).join("\n")}
      </pre>
      <p className="muted small">
        <code>VITE_INSTANT_APP_ID</code> — the marina's InstantDB app id.{" "}
        <code>VITE_CLERK_PUBLISHABLE_KEY</code> — the marina's Clerk
        application publishable key (with multi-session enabled, and a JWT
        template registered on the InstantDB app —{" "}
        <code>VITE_INSTANT_CLERK_CLIENT_NAME</code> if named something other
        than “clerk”).
      </p>
    </div>
  );
}
