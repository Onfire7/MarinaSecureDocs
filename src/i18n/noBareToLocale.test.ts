import { describe, expect, it } from "vitest";

// docs/localization.md § Catalogs — dates and numbers.
//
// `toLocaleDateString()` with no language formats in the *phone's*
// language, not the one the user chose, and keys mode cannot reveal it: a
// date still looks like a date. This is the one localization mistake a
// source scan can find reliably, so it is scanned for. Format through
// src/i18n/format.ts, or pass `uiLocale()`.
//
// BASELINE is the debt as of the infrastructure commit. It may only shrink:
// a file over its count fails (a new call slipped in), and a file under it
// fails too, so the list is kept honest as each area is converted.
const BASELINE: Record<string, number> = {
  "src/layout/SaveIndicator.tsx": 1,
  "src/lib/assets.ts": 1,
  "src/lib/auditReport.ts": 2,
  "src/pages/activity/ActivityLogPage.tsx": 1,
  "src/pages/assets/AssetDetailPage.tsx": 7,
  "src/pages/assets/CheckoutDialog.tsx": 1,
  "src/pages/audits/AuditsHomePage.tsx": 1,
  "src/pages/audits/LaunchAuditPage.tsx": 1,
  "src/pages/boats/BoatDetailPage.tsx": 1,
  "src/pages/checklists/ActiveChecklistPage.tsx": 1,
  "src/pages/checklists/ChecklistDetailPage.tsx": 3,
  "src/pages/checklists/ChecklistListPage.tsx": 1,
  "src/pages/checklists/checklistItems.tsx": 1,
  "src/pages/comms/ActiveCallPanel.tsx": 1,
  "src/pages/comms/ChatRoomPage.tsx": 1,
  "src/pages/comms/CommsHomePage.tsx": 2,
  "src/pages/comms/MissedCommsPage.tsx": 1,
  "src/pages/comms/SmsThreadPage.tsx": 1,
  "src/pages/contacts/ContactDetailPage.tsx": 1,
  "src/pages/contacts/LeaseDetailPage.tsx": 3,
  "src/pages/home/EndOfShiftPage.tsx": 1,
  "src/pages/home/cards.tsx": 4,
  "src/pages/incidents/IncidentDetailPage.tsx": 2,
  "src/pages/incidents/IncidentListPage.tsx": 1,
  "src/pages/locations/CheckpointDetailPage.tsx": 1,
  "src/pages/locations/LocationDetailPage.tsx": 3,
  "src/pages/reports/ReportsHomePage.tsx": 2,
  "src/pages/reports/ShiftReportPage.tsx": 3,
  "src/pages/reservations/NewReservationPage.tsx": 2,
  "src/pages/reservations/ReservationDetailPage.tsx": 8,
  "src/pages/reservations/ReservationListPage.tsx": 4,
  "src/pages/shared/TargetActivity.tsx": 1,
  "src/pages/tickets/TicketDetailPage.tsx": 2,
};

/** A locale-sensitive call whose language argument is missing or `undefined`. */
const BARE =
  /\.toLocale(?:Date|Time)?String\(\s*(?:\)|undefined\b)|new Intl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat|PluralRules|ListFormat)\(\s*(?:\)|undefined\b)/g;

// Every source file's text, through Vite rather than node:fs — the app's
// tsconfig deliberately has no Node types.
const SOURCES = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

function bareCalls(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [path, text] of Object.entries(SOURCES)) {
    const n = text.match(BARE)?.length ?? 0;
    if (n) counts[path.slice(1)] = n;
  }
  return counts;
}

describe("locale-sensitive formatting names its language", () => {
  it("the pattern catches the forms that matter, and not the ones that are fine", () => {
    const hits = (s: string) => s.match(BARE)?.length ?? 0;
    expect(hits("d.toLocaleDateString()")).toBe(1);
    expect(hits("d.toLocaleString(undefined, { month: 'short' })")).toBe(1);
    expect(hits("d.toLocaleTimeString(\n  undefined,\n  {})")).toBe(1);
    expect(hits("new Intl.NumberFormat()")).toBe(1);
    expect(hits("d.toLocaleDateString(uiLocale(), opts)")).toBe(0);
    expect(hits("new Intl.DateTimeFormat(lng)")).toBe(0);
  });

  it("no file has more — or fewer — than the baseline", () => {
    expect(bareCalls()).toEqual(BASELINE);
  });
});
