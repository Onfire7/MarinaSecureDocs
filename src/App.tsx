import { Suspense, lazy } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { canonicalTarget, missingConfig } from "./lib/config";
import { ErrorBoundary } from "./layout/ErrorBoundary";
import { Splash } from "./layout/Splash";
import { ConfigMissingPage } from "./pages/shared/ConfigMissingPage";
import { SharedAuditReportPage } from "./pages/audits/SharedAuditReportPage";

// The signed-in app is a separate chunk. A Share Link's page (/r/<key>) is
// public - no Clerk, no PowerSync, no shell - and is routed here before
// that chunk is even requested, so opening one never loads a sign-in or
// opens a local database (docs/audits.md § Sharing the results).
const AuthedApp = lazy(() => import("./AuthedApp"));

export default function App() {
  const missing = missingConfig();
  if (missing.length > 0) {
    return <ConfigMissingPage missing={missing} />;
  }
  // A share link that arrived on another address goes home before it
  // renders - see canonicalTarget(). Done here, at the top of the public
  // branch, so nothing of the report is fetched at the wrong origin.
  const home = canonicalTarget(window.location.origin, window.location.pathname + window.location.search);
  if (home) {
    window.location.replace(home);
    return <Splash />;
  }
  if (window.location.pathname.startsWith("/r/")) {
    return (
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
            <Route path="/r/:key" element={<SharedAuditReportPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    );
  }
  return (
    <Suspense fallback={<Splash />}>
      <AuthedApp />
    </Suspense>
  );
}
