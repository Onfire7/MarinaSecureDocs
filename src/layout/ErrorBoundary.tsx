import { Component, type ErrorInfo, type ReactNode } from "react";

// An uncaught throw during render unmounts the whole React tree, which shows
// up as a blank white page with nothing in the console the user would think
// to look for. That has now happened twice (the checkpoint deep link missing
// its provider, and again after the permission restructure), so failures get
// a visible surface instead of silence.
//
// Deliberately not a "reset" boundary: the errors this catches are bugs, not
// transient states, and a retry button would just re-throw. It shows what
// broke and offers a reload.
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the full component stack in the console for debugging — the
    // on-screen copy stays short enough to read on a phone.
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="auth-screen">
        <div className="auth-brand">
          <div className="marina-name">Something went wrong</div>
          <div className="product">MarinaSecure</div>
        </div>
        <p className="muted" style={{ maxWidth: 420, textAlign: "center" }}>
          This screen failed to load. Reloading may clear it; if it keeps
          happening, send this message to whoever maintains the app.
        </p>
        <pre
          className="small"
          style={{
            maxWidth: 420,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            textAlign: "left",
          }}
        >
          {error.message}
        </pre>
        <button
          type="button"
          className="btn"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
