// The full-screen "Loading…" shown while Clerk loads, while the marina user
// resolves, and while the authenticated app's chunk downloads.
export function Splash() {
  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <div className="marina-name">MarinaSecure</div>
        <div className="product">Loading…</div>
      </div>
    </div>
  );
}
