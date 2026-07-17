import { Link, Navigate } from "react-router-dom";
import { SignIn, useAuth, useSessionList } from "@clerk/clerk-react";
import { db } from "../../lib/db";

// Access — Sign In (see pages/sign-in.html).
// Authentication itself is Clerk's embedded component; identifier/challenge
// method is configured per marina in Clerk's dashboard, not hand-built here.
export function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { sessions } = useSessionList();
  const marinaName = useMarinaName();

  // Already has a valid session → this screen is skipped entirely.
  if (isLoaded && isSignedIn) {
    return <Navigate to="/" replace />;
  }

  const hasOtherSessions = (sessions ?? []).length > 0;

  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <div className="marina-name">{marinaName}</div>
        <div className="product">MarinaSecure</div>
      </div>
      <div className="auth-card">
        <SignIn routing="hash" />
      </div>
      {hasOtherSessions && (
        <Link to="/switch-user" className="small">
          Switch to a signed-in user instead
        </Link>
      )}
      <p className="muted small" style={{ maxWidth: 380, textAlign: "center" }}>
        Accounts are created by a manager in Admin → Users. First sign-in on a
        device requires connectivity.
      </p>
    </div>
  );
}

function useMarinaName(): string {
  // MarinaSettings branding, shown before credentials are entered.
  const { data } = db.useQuery({ marinaSettings: {} });
  return data?.marinaSettings?.[0]?.marinaName ?? "Marina";
}
