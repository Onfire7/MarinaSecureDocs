import { describe, expect, it } from "vitest";

// Test 8 of the approved list for the Shift Report: the public page's data
// module and page import nothing that reaches Clerk, PowerSync or the app's
// database client, the same rule the audit share page lives by
// (CLAUDE.md § Learnings: a static import loads even when nothing renders
// it). Every source file's text, through Vite, like noBareToLocale.test.ts.
const SOURCES = import.meta.glob<string>(["/src/**/*.{ts,tsx}", "!/src/**/*.test.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const PUBLIC_FILES = [
  "src/data/sharedShiftReport.ts",
  "src/data/sharedReport.ts",
  "src/pages/reports/SharedShiftReportPage.tsx",
  "src/pages/reports/ShiftReportView.tsx",
  "src/pages/audits/SharedAuditReportPage.tsx",
  "src/pages/audits/AuditReportView.tsx",
];

const FORBIDDEN = /from\s+["'][^"']*(?:\/lib\/db(?:\/|["'])|@clerk\/|@powersync\/|\/data\/sync|\/auth\/)/;

describe("the public report bundle stays free of Clerk, PowerSync and the app's database", () => {
  it("every public file exists and imports none of them", () => {
    for (const file of PUBLIC_FILES) {
      const text = SOURCES["/" + file];
      expect(text, `${file} is missing`).toBeDefined();
      const hit = text!.match(FORBIDDEN);
      expect(hit, `${file}: ${hit?.[0] ?? ""}`).toBeNull();
    }
  });
});
