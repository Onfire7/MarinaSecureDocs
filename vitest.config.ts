import { defineConfig } from "vitest/config";

/**
 * Unit tests only, and deliberately so.
 *
 * These target the pure half of `src/lib` — the ~1,900 lines that never
 * import the database. That is not an arbitrary scope: the app is migrating
 * off InstantDB (see docs/adr/0005-…), and tests written against a database
 * client would be thrown away with it, while tests over pure logic transfer
 * intact. Anything needing a live database or a rendered component is
 * verified by driving a real signed-in session instead — see CLAUDE.md.
 *
 * No plugins and `environment: "node"`: nothing here touches the DOM, and
 * loading vite.config.ts would pull in the PWA plugin and print the
 * DEBUG_BUILD banner on every run.
 */
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // src/data is in scope. It is the layer the rewrite created, and leaving
      // it out would mean the "every untested file is a decision" rule quietly
      // stopped applying to the newest half of the codebase.
      // src/i18n too: its resolution order and checks are pure logic, and
      // the browser wiring in index.ts is a logged decision, not an accident.
      include: ["src/lib/**/*.ts", "src/data/**/*.ts", "src/i18n/**/*.ts"],
      exclude: ["src/lib/db/**", "src/lib/auth/**"],
      reporter: ["text", "json-summary"],
    },
  },
});
