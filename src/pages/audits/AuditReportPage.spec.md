# Audit report page

Two routes, one component. `/r/:key` — public, no shell, no sign-in, no
local database; the page a Share Link opens. `/audits/:id/report` — the same
report inside the app for anyone who can see the audit. Behaviour is
`docs/audits.md` § Sharing the results; this file records what the page
itself commits to.

- **One fetch.** The page calls `audit_report(key)` (public) or
  `audit_report_for(audit_id)` (in-app) and renders the returned document.
  It never assembles the report from tables itself; the document is built in
  one place, in the database, so a shared view and an in-app view can never
  disagree. Presentation - the sentences, the wide rows, the CSV - is pure
  TypeScript over that document (`src/lib/auditReport.ts`).
- **Three states.** *Assembling the report…* while the fetch is out; the
  report; or the neutral *This report link is no longer active* page for a
  null result - expired, revoked and unknown keys are indistinguishable here.
- **Layout, top to bottom** (settled by prototype D, second cut): a
  letterhead - marina and kind on top, the audit name, the status and dates,
  with *launched by / audited by / as of* and *Export…* on the right, ruled
  off underneath; *Executive summary* as prose, first sentence larger, no
  wider than ~900px; the tile row; the three-card band (coverage bar;
  services present / not working, or occupancy found; questions); *Needs
  attention* as a list; *Results* with the tab row, filters and table. Tiles
  wrap to two per row on a phone and the band stacks; the letterhead's right
  column left-aligns under 600px.
- **Per location is the default tab**; the filter row (state select, search)
  applies to both tabs and to every export. The wide table scrolls
  horizontally with its first column pinned; column headers longer than
  ~22 characters are truncated with the full prompt in a tooltip.
- **Cell vocabulary** is exactly the table in `docs/audits.md`: `-` for not
  recorded, `*` for proposed by this audit, `!` for does not match the file.
  Not-working, No and `!` cells are in the danger colour; `-` recedes.
- **Attention rows** carry a mark at the left edge in both tabs.
- **Export…** opens a small panel: format checkboxes (PDF, Excel, CSV; at
  least one) and a rows select (per location / per item / both). CSV and
  Excel download; PDF calls `window.print()` under the print stylesheet,
  which hides the top bar, the export panel, the filter row and the tab row
  and forces the light theme.
- **In-app only**: location names link to `/audits/:id/targets/:targetId`,
  and the header carries *← back to the audit*.
- **Public only**: a slim top bar - "MarinaSecure · shared audit report" -
  and nothing else of the app. No console noise: the page must not load
  Clerk or PowerSync.
- **Stamps.** A Closed audit's header says *as of <time>* from the
  document's `asOf`; a Finalized one says *finalized <date>* and the page
  never refetches.
- **Theme** follows the viewer (system, or the app's stored choice when
  in-app); print is light.
