import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ClerkProvider, useAuth, useClerk } from "@clerk/clerk-react";
import { CLERK_PUBLISHABLE_KEY, missingConfig } from "./lib/config";
import { InstantAuthSync } from "./lib/auth/InstantAuthSync";
import {
  CurrentUserProvider,
  useCurrent,
} from "./lib/auth/CurrentUserContext";
import { AppShell } from "./layout/AppShell";
import { SignInPage } from "./pages/access/SignInPage";
import { UserSwitchPage } from "./pages/access/UserSwitchPage";
import { DashboardPage } from "./pages/home/DashboardPage";
import { MorePage } from "./pages/shared/MorePage";
import { PlaceholderPage } from "./pages/shared/PlaceholderPage";
import { ConfigMissingPage } from "./pages/shared/ConfigMissingPage";

export default function App() {
  const missing = missingConfig();
  if (missing.length > 0) {
    return <ConfigMissingPage missing={missing} />;
  }

  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY!}
      afterSignOutUrl="/sign-in"
    >
      <InstantAuthSync />
      <BrowserRouter>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/switch-user" element={<UserSwitchPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/more" element={<MorePage />} />
            <Route
              path="/checklists/*"
              element={<PlaceholderPage title="Checklists & Tours" spec="checklist-list" />}
            />
            <Route
              path="/locations/*"
              element={<PlaceholderPage title="Locations" spec="location-list" />}
            />
            <Route
              path="/comms/*"
              element={<PlaceholderPage title="Comms" spec="comms-home" />}
            />
            <Route
              path="/tickets/*"
              element={<PlaceholderPage title="Tickets" spec="ticket-queue" />}
            />
            <Route
              path="/incidents/*"
              element={<PlaceholderPage title="Incidents" spec="incident-list" />}
            />
            <Route
              path="/reservations/*"
              element={<PlaceholderPage title="Reservations" spec="reservation-list" />}
            />
            <Route
              path="/boats/*"
              element={<PlaceholderPage title="Boats" spec="boat-list" />}
            />
            <Route
              path="/contacts/*"
              element={<PlaceholderPage title="Owners & Contacts" spec="contact-list" />}
            />
            <Route
              path="/assets/*"
              element={<PlaceholderPage title="Assets" spec="asset-list" />}
            />
            <Route
              path="/activity"
              element={<PlaceholderPage title="Activity Log" spec="activity-log" />}
            />
            <Route
              path="/reports/*"
              element={<PlaceholderPage title="Reports" spec="reports-home" />}
            />
            <Route
              path="/admin/*"
              element={<PlaceholderPage title="Admin" spec="admin-home" />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ClerkProvider>
  );
}

// Gate: Clerk session required, then the marina User record must resolve.
function RequireAuth() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <Splash />;
  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return (
    <CurrentUserProvider>
      <ProvisionGate />
    </CurrentUserProvider>
  );
}

function ProvisionGate() {
  const current = useCurrent();
  const { signOut } = useClerk();

  if (current.isLoading) return <Splash />;

  if (current.unprovisioned) {
    // Same generic presentation whether the account was never provisioned or
    // was deactivated — the UI does not reveal which (see Sign In spec).
    return (
      <div className="auth-screen">
        <div className="auth-brand">
          <div className="marina-name">Unable to sign in</div>
          <div className="product">MarinaSecure</div>
        </div>
        <p className="muted" style={{ maxWidth: 380, textAlign: "center" }}>
          This account can’t access this marina. Check with a manager if you
          believe this is an error.
        </p>
        <button type="button" className="btn" onClick={() => void signOut()}>
          Back to sign in
        </button>
      </div>
    );
  }

  return <AppShell />;
}

function Splash() {
  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <div className="marina-name">MarinaSecure</div>
        <div className="product">Loading…</div>
      </div>
    </div>
  );
}
