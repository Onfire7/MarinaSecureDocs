import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { ClerkProvider, useAuth, useClerk } from "@clerk/clerk-react";
import { CLERK_PUBLISHABLE_KEY, missingConfig } from "./lib/config";
import { PowerSyncProvider } from "./lib/db/PowerSyncProvider";
import {
  CurrentUserProvider,
  useCurrent,
} from "./lib/auth/CurrentUserContext";
import { useSyncConfigError } from "./lib/auth/syncStatus";
import { AppShell } from "./layout/AppShell";
import { ErrorBoundary } from "./layout/ErrorBoundary";
import { SignInPage } from "./pages/access/SignInPage";
import { UserSwitchPage } from "./pages/access/UserSwitchPage";
import { DashboardPage } from "./pages/home/DashboardPage";
import { MorePage } from "./pages/shared/MorePage";
import { ConfigMissingPage } from "./pages/shared/ConfigMissingPage";
import { ChecklistListPage } from "./pages/checklists/ChecklistListPage";
import { ChecklistRoute } from "./pages/checklists/ChecklistRoute";
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
import { AdminSetupWizardPage } from "./pages/admin/AdminSetupWizardPage";
import { AdminCheckpointsPage } from "./pages/admin/AdminCheckpointsPage";
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
      <PowerSyncProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Routes>
              <Route path="/sign-in" element={<SignInPage />} />
              <Route path="/switch-user" element={<UserSwitchPage />} />
              <Route element={<RequireAuth />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/more" element={<MorePage />} />
                {/* The NFC/QR deep link. It lives inside the shell like any
                    other screen — a guard who scans a tag still needs the nav
                    to get anywhere afterward. An unauthenticated scan still
                    resolves: RequireAuth sends it through Sign In carrying a
                    returnTo, and it resumes here. */}
                <Route path="/checkin/:guidUrl" element={<CheckpointCheckinPage />} />
                <Route path="/checklists" element={<ChecklistListPage />} />
                {/* Tour steps moved inline onto the Checklist list; old links
                    and bookmarks land there rather than 404ing. */}
                <Route path="/checklists/tours/:tourId" element={<Navigate to="/checklists" replace />} />
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
                <Route path="/admin/setup" element={<AdminSetupWizardPage />} />
                <Route path="/admin/checkpoints" element={<AdminCheckpointsPage />} />
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
      </PowerSyncProvider>
    </ClerkProvider>
  );
}

// Gate: Clerk session required, then the marina User record must resolve.
function RequireAuth() {
  const { isLoaded, isSignedIn } = useAuth();
  const location = useLocation();
  if (!isLoaded) return <Splash />;
  if (!isSignedIn) {
    // Carry the intended destination through Sign In so the deep link
    // resumes afterward instead of dumping the user on the Dashboard. The
    // check-in scan depends on this, but every deep link benefits.
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <Navigate
        to={
          returnTo === "/"
            ? "/sign-in"
            : `/sign-in?returnTo=${encodeURIComponent(returnTo)}`
        }
        replace
      />
    );
  }
  return (
    <CurrentUserProvider>
      <ProvisionGate />
    </CurrentUserProvider>
  );
}

function ProvisionGate() {
  const current = useCurrent();
  const syncConfigError = useSyncConfigError();
  const { signOut } = useClerk();
  const location = useLocation();

  if (current.isLoading) return <Splash />;

  // A recorded REFUSAL outranks everything below it, and this ordering is the
  // whole point of the screen. A rejected token means the device never
  // connects, so it also never syncs — which makes every other diagnosis here
  // true at the same time and all of them wrong. Told "find signal", someone
  // walks outside; told "ask a manager", they ask about an account that is
  // fine. Only this screen names the thing that is actually broken.
  //
  // Verified against the real failure: with no `aud` claim on the Clerk token,
  // PowerSync answers PSYNC_S2105 and this is the screen that appears.
  if (syncConfigError) return <SyncConfigErrorScreen message={syncConfigError} />;

  // A device that has never synced holds nothing, so it cannot tell an
  // unprovisioned account from an unsynced one — and the two need opposite
  // advice. Checked before `unprovisioned` because both are true here.
  if (current.needsFirstSync) return <FirstSyncScreen />;

  if (current.unprovisioned) {
    // A Clerk identity with no marina User can't author a check-in, and a
    // guard who just scanned a tag needs to know the scan didn't record —
    // not just that sign-in failed.
    const fromScan = location.pathname.startsWith("/checkin/");
    // Same generic presentation whether the account was never provisioned or
    // was deactivated — the UI does not reveal which (see Sign In spec).
    return (
      <div className="auth-screen">
        <div className="auth-brand">
          <div className="marina-name">
            {fromScan ? "Unable to check in" : "Unable to sign in"}
          </div>
          <div className="product">MarinaSecure</div>
        </div>
        <p className="muted" style={{ maxWidth: 380, textAlign: "center" }}>
          {fromScan
            ? "This account can’t access this marina, so the check-in wasn’t recorded. Check with a manager."
            : "This account can’t access this marina. Check with a manager if you believe this is an error."}
        </p>
        <button type="button" className="btn" onClick={() => void signOut()}>
          Back to sign in
        </button>
      </div>
    );
  }

  return <AppShell />;
}

// A device that has never completed a sync, with no connection to complete one
// on. Everything else in this app works offline; this is the single moment
// that cannot, because there is genuinely no data on the device yet.
function FirstSyncScreen() {
  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <div className="marina-name">Setting up this device</div>
        <div className="product">MarinaSecure</div>
      </div>
      <p className="muted" style={{ maxWidth: 380, textAlign: "center" }}>
        This device hasn’t downloaded the marina’s data yet, and there’s no
        connection right now. Move somewhere with signal or Wi-Fi and it will
        finish on its own — after that the app works offline.
      </p>
    </div>
  );
}

// The Clerk sign-in worked but the marina's database refused the connection —
// a deployment problem, not an account problem. Most likely: PowerSync's JWKS
// URL doesn't match this Clerk application, or Supabase isn't configured to
// trust Clerk as a third-party auth provider.
function SyncConfigErrorScreen({ message }: { message: string }) {
  return (
    <div className="auth-screen">
      <div className="auth-brand">
        <div className="marina-name">Can’t reach the marina database</div>
        <div className="product">MarinaSecure</div>
      </div>
      <p className="muted" style={{ maxWidth: 420, textAlign: "center" }}>
        You signed in, but the marina’s database turned the connection away,
        so nothing can load. More signal will not help — this is a setup
        problem with the app. Send this message to whoever maintains it:
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
