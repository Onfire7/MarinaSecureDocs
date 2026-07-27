import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ClerkProvider, useAuth, useClerk } from "@clerk/clerk-react";
import { CLERK_PUBLISHABLE_KEY, missingConfig } from "./lib/config";
import { InstantAuthSync } from "./lib/auth/InstantAuthSync";
import {
  CurrentUserProvider,
  useCurrent,
} from "./lib/auth/CurrentUserContext";
import { useInstantAuthError } from "./lib/auth/instantAuthStatus";
import { AppShell } from "./layout/AppShell";
import { ErrorBoundary } from "./layout/ErrorBoundary";
import { SignInPage } from "./pages/access/SignInPage";
import { UserSwitchPage } from "./pages/access/UserSwitchPage";
import { DashboardPage } from "./pages/home/DashboardPage";
import { MorePage } from "./pages/shared/MorePage";
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
import { ContactListPage } from "./pages/contacts/ContactListPage";
import { ContactDetailPage } from "./pages/contacts/ContactDetailPage";
import { LeaseDetailPage } from "./pages/contacts/LeaseDetailPage";
import { AssetListPage } from "./pages/assets/AssetListPage";
import { AssetDetailPage } from "./pages/assets/AssetDetailPage";
import { ActivityLogPage } from "./pages/activity/ActivityLogPage";
import { CommsHomePage } from "./pages/comms/CommsHomePage";
import { ChatRoomPage } from "./pages/comms/ChatRoomPage";
import { NewChatRoomPage } from "./pages/comms/NewChatRoomPage";
import { SmsThreadPage } from "./pages/comms/SmsThreadPage";
import { MissedCommsPage } from "./pages/comms/MissedCommsPage";
import { AdminHomePage } from "./pages/admin/AdminHomePage";
import { AdminUsersPage } from "./pages/admin/AdminUsersPage";
import { AdminRolesPage } from "./pages/admin/AdminRolesPage";
import { AdminChecklistTemplatesPage } from "./pages/admin/AdminChecklistTemplatesPage";
import { AdminLocationsPage } from "./pages/admin/AdminLocationsPage";
import { AdminToursPage } from "./pages/admin/AdminToursPage";
import { AdminIncidentTypesPage } from "./pages/admin/AdminIncidentTypesPage";
import { AdminAssetsPage } from "./pages/admin/AdminAssetsPage";
import { AdminSmsTemplatesPage } from "./pages/admin/AdminSmsTemplatesPage";
import { AdminMarinaSettingsPage } from "./pages/admin/AdminMarinaSettingsPage";
import { ReportsHomePage } from "./pages/reports/ReportsHomePage";
import { ShiftReportPage } from "./pages/reports/ShiftReportPage";

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
        <ErrorBoundary>
          <Routes>
            <Route path="/sign-in" element={<SignInPage />} />
            <Route path="/switch-user" element={<UserSwitchPage />} />
            {/* Public deep link (NFC/QR): sits outside RequireAuth so an
                unauthenticated scan still resolves, but supplies the
                current-user context the check-in write needs. */}
            <Route path="/checkin/:guidUrl" element={<CheckinRoute />} />
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
              <Route path="/comms" element={<CommsHomePage />} />
              <Route path="/comms/missed" element={<MissedCommsPage />} />
              <Route path="/comms/chat/new" element={<NewChatRoomPage />} />
              <Route path="/comms/chat/:id" element={<ChatRoomPage />} />
              <Route path="/comms/sms/:id" element={<SmsThreadPage />} />
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
              <Route path="/contacts" element={<ContactListPage />} />
              <Route
                path="/contacts/leases/new"
                element={<LeaseDetailPage mode="create" />}
              />
              <Route path="/contacts/leases/:id" element={<LeaseDetailPage />} />
              <Route path="/contacts/:id" element={<ContactDetailPage />} />
              <Route path="/assets" element={<AssetListPage />} />
              <Route path="/assets/:id" element={<AssetDetailPage />} />
              <Route path="/activity" element={<ActivityLogPage />} />
              <Route path="/reports" element={<ReportsHomePage />} />
              <Route path="/reports/shifts/:id" element={<ShiftReportPage />} />
              <Route path="/admin" element={<AdminHomePage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/roles" element={<AdminRolesPage />} />
              <Route
                path="/admin/checklist-templates"
                element={<AdminChecklistTemplatesPage />}
              />
              <Route path="/admin/locations" element={<AdminLocationsPage />} />
              <Route path="/admin/tours" element={<AdminToursPage />} />
              <Route path="/admin/incident-types" element={<AdminIncidentTypesPage />} />
              <Route path="/admin/assets" element={<AdminAssetsPage />} />
              <Route path="/admin/sms-templates" element={<AdminSmsTemplatesPage />} />
              <Route path="/admin/settings" element={<AdminMarinaSettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </ClerkProvider>
  );
}

/**
 * Auth gate for the checkpoint deep link. Same Clerk requirement as the rest
 * of the app, but it redirects through Sign In carrying a returnTo so the
 * scan resumes afterward, rather than dumping the guard on the dashboard.
 */
function CheckinRoute() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <Splash />;
  if (!isSignedIn) {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    return (
      <Navigate to={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`} replace />
    );
  }
  return (
    <CurrentUserProvider>
      <CheckinGate />
    </CurrentUserProvider>
  );
}

// A Clerk identity with no marina User record can't be the author of a
// check-in, so say so plainly instead of silently recording nothing.
function CheckinGate() {
  const current = useCurrent();
  const instantAuthError = useInstantAuthError();
  if (current.isLoading) return <Splash />;
  if (current.unprovisioned) {
    if (instantAuthError) {
      return <InstantAuthErrorScreen message={instantAuthError} />;
    }
    return (
      <div className="auth-screen">
        <div className="auth-brand">
          <div className="marina-name">Unable to check in</div>
          <div className="product">MarinaSecure</div>
        </div>
        <p className="muted" style={{ maxWidth: 380, textAlign: "center" }}>
          This account can't access this marina, so the check-in wasn't
          recorded. Check with a manager.
        </p>
      </div>
    );
  }
  return <CheckpointCheckinPage />;
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
  const instantAuthError = useInstantAuthError();
  const { signOut } = useClerk();

  if (current.isLoading) return <Splash />;

  if (current.unprovisioned) {
    // An empty user query means nothing when the Clerk → Instant token
    // exchange itself was rejected — every query is running anonymously and
    // the permission rules are (correctly) denying it. Showing the account
    // message for that sent a whole debugging session down the wrong road.
    if (instantAuthError) {
      return <InstantAuthErrorScreen message={instantAuthError} />;
    }
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

// The Clerk sign-in worked but Instant refused the token exchange — a
// deployment/configuration problem (most commonly this origin missing from
// the Instant app's allowed origins), not an account problem.
function InstantAuthErrorScreen({ message }: { message: string }) {
  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <div className="marina-name">Can’t reach the marina database</div>
        <div className="product">MarinaSecure</div>
      </div>
      <p className="muted" style={{ maxWidth: 420, textAlign: "center" }}>
        You signed in, but the connection to the marina’s database was
        refused, so nothing can load. This is a setup problem with the app —
        send this message to whoever maintains it:
      </p>
      <pre
        className="small"
        style={{
          maxWidth: 420,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {message}
      </pre>
      <button
        type="button"
        className="btn"
        onClick={() => window.location.reload()}
      >
        Retry
      </button>
    </div>
  );
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
