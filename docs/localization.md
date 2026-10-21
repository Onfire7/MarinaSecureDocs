# Localization

How MarinaSecure speaks more than one language. The decision and the
rejected alternatives are in
[ADR 0009](adr/0009-copy-in-catalogs-data-in-its-own-language.md); this
file is the working spec.

## Copy and data

**Copy** is text the app authors: headings, labels, buttons, placeholders,
`aria-label`s, `title`s, empty states, toasts, error messages, plurals, and
how dates and numbers are formatted. Copy lives in the catalog.

**Data** is text that came out of the database: location names, statuses,
roles, incident types, checklist templates and their items, SMS templates,
contact names, notes. Data is rendered as stored and never passed through
`t()`. That holds even when the row was originally seeded by the app.

The test is where the string lives at render time. If it is in a `.ts` or
`.tsx` file, it is copy. If it was read from a table, it is data.

## Two languages

| | UI language | Data language |
|---|---|---|
| Belongs to | the signed-in user | the marina |
| Stored in | `users.language` (null = follow the device) | `marina_settings.language` (default `en`) |
| Decides | how the app speaks to this user | what language the app *writes into the database* |
| Changed on | More page and the desktop sidenav, beside the theme toggle | Marina Settings |

**The UI language** resolves in this order: keys mode (below), then
`users.language`, then the last language used on this device, then
`navigator.languages`, then English (`src/i18n/resolveLanguage.ts`). The
device's last language is kept in `localStorage` (`ms.lng`) so the sign-in
screen and the first paint before sync are already right. It is consulted
**only until the user row has loaded**. After that, a user on "Device
default" gets the browser's language, not whatever the previous person on a
shared phone chose. A code with no catalog is skipped at every step, and
`es-MX` matches `es`.

Which codes are valid is the app's business. A code is valid when
`src/i18n/locales/<code>/` exists. The database checks only that the value
is shaped like a language code, so adding a language never needs a
migration. A stored code with no catalog falls back as above, and the
pickers still list it so the select shows what is actually stored.

`LanguageSync` (`src/layout/`), mounted inside `CurrentUserProvider`,
applies both columns as they sync. It also follows a User Switch.

**The data language** is used for every string the app generates and
stores:

- `activity_log_entries.summary`, and the fragments passed into it, such as
  the "reason" a checklist was created ("clock-in", "its recurring
  schedule").
- Auto-raised ticket and incident titles and descriptions ("Failed Verify
  Task: …", "Door left open: …", "Raised automatically at …").
- Status-log notes ("Returned from checkout", "Reservation check-in"),
  audit displaced notes, and default names ("New template", "X (copy)").

Data modules get a fixed translator for this. They never use the UI `t`:
`dataT(key, opts)` from `src/i18n/index.ts`, bound to the marina's
language. `dataT` ignores keys mode: a key written into the Activity Log
would be there for good. A Spanish-speaking guard at an English marina sees
a Spanish UI and writes English log lines. That is intended.

**Public pages** (`/r/<key>`) have no user. They use the device's last
language if it has one, else the browser's, else English. An on-page
switcher is deferred to the ROADMAP. The public bundle must still not load Clerk or
PowerSync, so `src/i18n/index.ts` imports neither.

## Catalogs

```
src/i18n/
  index.ts            the app's localizer: dataT, uiLocale, date/time/number,
                      applyUserLanguage, applyMarinaLanguage, languageName
  localizer.ts        createLocalizer(), browser-free, so tests can build one
  resolveLanguage.ts  the UI-language order, keys mode, the code shape
  catalogs.ts         CATALOGS and LANGUAGES, found by folder (import.meta.glob)
  format.ts           makeFormatters(): dates and numbers in a given language
  catalogCheck.ts     key-set and plural-form checks, for catalogs.test.ts
  i18next.d.ts        types every t() against the English catalog
  locales/en/index.ts default export { admin, common, … }; export type Catalog
  locales/en/common.ts  shared copy, plus languageName (the language's own name)
  locales/en/<area>.ts  one namespace per src/pages/<area>/ (+ layout)
  locales/es/…        added when translation starts; `satisfies Catalog`
```

- **English is the source of truth.** A key exists when it is in
  `en/<area>.ts`. Every other locale is typed `satisfies Catalog`, so
  a missing or extra key fails `tsc -b`. A locale goes into `LANGUAGES`
  (and so into the picker) only once its catalog is complete. There is no
  partially translated language in production.
- **Keys** are camelCase, and nested only where it groups siblings
  (`range.year`). Name a key for what the text means, not for its wording.
  `shiftOpen`, not `inProgressDot`.
- **Whole sentences only.** Never concatenate translated fragments, and
  never interpolate a translated word into another translated string. Word
  order differs between languages. Use `{{name}}` interpolation inside one
  message.
- **Plurals** use i18next suffixes (`_one`, `_other`, and whichever forms a
  locale needs) with `count`. Never write `n === 1 ? … : …`.
- **Dates and numbers** are formatted inside the message
  (`{{start, datetime(month: short; day: numeric)}}`) or through `date`,
  `time`, `dateTime` and `number` from `src/i18n`. A `toLocale*String()` or
  `new Intl.*()` without a language formats in the *phone's* language, and
  keys mode cannot reveal it. `noBareToLocale.test.ts` fails on a new one.
  Its baseline lists the existing ones per file and must shrink to empty as
  areas convert.
- **Enum labels** (machine values like `clock_in`, `not_audited`, `medium`
  priority) are translated at display time by key (`t(\`trigger.${v}\`)`).
  The stored value never changes.
- **Pages** use `useTranslation("<area>")`. Non-React code in `src/lib`
  that returns display text takes a `t` parameter, or returns a key and
  its values for the caller to render, so it stays pure and unit-testable.

## Keys mode

`?lng=keys` makes every catalog lookup render as `namespace:key` instead of
text (i18next's `cimode`, with the namespace appended). The choice is kept
in `localStorage` until `?lng=` clears it. In keys mode, any readable
English on screen is either data or copy that escaped the catalog. That is
how untranslated text is found.

`pnpm run i18n:coverage` (`scripts/e2e/i18n-coverage.mjs`) automates the
look. It reuses the `agent-login.mjs` session, switches to keys mode, and
walks every screen reachable by links, visiting each route shape once. It
collects visible text nodes plus `placeholder`, `title`, `aria-label` and
`alt`, drops everything that is key-shaped or has no letters, and writes
what remains, each string under the first route it appeared on, to `/tmp/pw-test/i18n-coverage.txt`, with a
screenshot of each route under `/tmp/pw-test/screenshots/i18n/`. It
follows links and never presses a button. So dialogs, menus and
button-revealed panels are not covered and need a manual look in keys
mode. It skips `/checkin/<guid>`, which records a check-in when opened. The
output still contains data (a boat name *is* readable text), so it is a
report for review, not a pass/fail gate. The reviewer marks what is copy.
Known data-only strings that recur (the test account's name, seeded
location names) are listed in `scripts/e2e/i18n-coverage.ignore` to keep
the report short.

## Rollout

1. **Infrastructure**: i18next, `common` namespace, formatters, keys
   mode, `dataT`, the two `language` columns, the picker on the More page
   and the sidenav, the Marina Settings field, the coverage script, and
   the CLAUDE.md rule. English only. No visible change except the picker,
   which offers only English until a second catalog is complete.
2. **One commit per area**, converting its pages *and* the `src/lib` /
   `src/data` strings that area writes, each verified on beta2 in English
   and in keys mode: layout + shared, home, checklists, locations,
   tickets, incidents, reservations, boats, contacts, assets, comms,
   activity, reports, audits, access, admin.
3. **Spanish**: `es/` catalogs, `satisfies Catalog`, then added to
   `LANGUAGES`.

## Out of scope

- Anything stored in the database. That includes SMS templates, which are
  marina-authored rows.
- English written by SQL functions (`apply_location_proposal` and its
  audit trail strings, `'closed early'`, `'nothing was on file'`). See
  ROADMAP.
- Lookups by English row name (`resolveStatusByName("Vacant")` and
  friends), which break for a marina set up in another language. Already
  fragile, and recorded in the ROADMAP rather than fixed here.
