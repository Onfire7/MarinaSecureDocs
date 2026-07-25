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
import { ChecklistListPage } from "./pages/checklists/ChecklistListPage";
import { ChecklistRoute } from "./pages/checklists/ChecklistRoute";
import { TourProgressPage } from "./pages/checklists/TourProgressPage";
import { CheckpointCheckinPage } from "./pages/checklists/CheckpointCheckinPage";
import { LocationListPage } from "./pages/locations/LocationListPage";
import { LocationDetailPage } from "./pages/locations/LocationDetailPage";
import { CheckpointDetailPage } from "./pages/locations/CheckpointDetailPage";
import { TicketQueuePage } from "./pages/tickets/TicketQueuePage";
import { TicketDetailPage } from "./pages/tickets/TicketDetailPage";
import { NewTicketPage } from "./pages/tickets/NewTicketPage";
import { IncidentListPage } from "./pages/incidents/IncidentListPage";
import { IncidentDetailPage } from "./pages/incidents/IncidentDetailPage";
import { NewIncidentPage } from "./pages/incidents/NewIncidentPage";
import { ReservationListPage } from "./pages/reservations/ReservationListPage";
import { ReservationDetailPage } from "./pages/reservations/ReservationDetailPage";
import { NewReservationPage } from "./pages/reservations/NewReservationPage";
import { BoatListPage } from "./pages/boats/BoatListPage";
import { BoatDetailPage } from "./pages/boats/BoatDetailPage";
import { VehicleDetailPage } from "./pages/boats/VehicleDetailPage";

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
          {/* Public deep link (NFC/QR): handles its own auth gate so an
              unauthenticated scan can detour through Sign In and resume. */}
          <Route path="/checkin/:guidUrl" element={<CheckpointCheckinPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/more" element={<MorePage />} />
            <Route path="/checklists" element={<ChecklistListPage />} />
            <Route path="/checklists/tours/:tourId" element={<TourProgressPage />} />
            <Route path="/checklists/:id" element={<ChecklistRoute />} />
            <Route path="/locations" element={<LocationListPage />} />
            <Route
              path="/locations/checkpoints/:id"
              element={<CheckpointDetailPage />}
            />
            <Route path="/locations/:id" element={<LocationDetailPage />} />
            <Route
              path="/comms/*"
              element={<PlaceholderPage title="Comms" spec="comms-home" />}
            />
            <Route path="/tickets" element={<TicketQueuePage />} />
            <Route path="/tickets/new" element={<NewTicketPage />} />
            <Route path="/tickets/:id" element={<TicketDetailPage />} />
            <Route path="/incidents" element={<IncidentListPage />} />
            <Route path="/incidents/new" element={<NewIncidentPage />} />
            <Route path="/incidents/:id" element={<IncidentDetailPage />} />
            <Route path="/reservations" element={<ReservationListPage />} />
            <Route path="/reservations/new" element={<NewReservationPage />} />
            <Route path="/reservations/:id" element={<ReservationDetailPage />} />
            <Route path="/boats" element={<BoatListPage />} />
            <Route path="/boats/:id" element={<BoatDetailPage />} />
            <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
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
