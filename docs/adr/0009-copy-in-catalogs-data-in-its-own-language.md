# App copy lives in i18next catalogs; data stays in the language it was written in

MarinaSecure is getting a second language (Spanish first). Every string the
app itself authors — labels, messages, empty states, plurals, date formats —
moves into typed i18next catalogs under `src/i18n/`, and is rendered in the
signed-in user's chosen language. Everything stored in the database is
*data* and is never translated: a marina's location names, statuses,
checklist wording and SMS templates appear exactly as the marina typed them.

There are therefore two languages in play, and they are not the same thing:

- **The UI language** belongs to a user (`users.language`, falling back to
  the device's language, then English). It decides how the app speaks.
- **The data language** belongs to the marina (`marina_settings.language`,
  chosen at setup). Text the app *generates into the database* — Activity
  Log summaries, auto-raised ticket titles, default names like "New
  template" — is written in the data language, whoever is signed in, so a
  marina's records read in one language.

Catalogs are TypeScript modules, not JSON. English is the source of truth;
every other locale is declared `satisfies Catalog`, so a key missing from a
translation, or a mistyped key in a page, fails `tsc -b` instead of quietly
showing English.

**Rejected.** Translating database text: user-entered strings are short,
translation of them goes wrong in ways nobody notices, and it would need a
translation per row. Writing generated text in the *writer's* UI language:
one marina's log would alternate languages line by line. Storing Activity
Log events as structured data and composing the sentence at read time: the
most correct option, but it reverses the log's "generated at write time,
never recomputed" design for a benefit the data-language rule mostly
delivers. A lint rule against hard-coded JSX text: oxlint has none, and
data rendered from the database is indistinguishable from copy to a
linter. Detection is instead done at runtime, by rendering keys in place of
copy (see `docs/localization.md`).

**Consequences.** English text written by SQL functions (the audit
proposal functions) is not covered and is recorded in `docs/ROADMAP.md`.
Code that finds a row by its English *name* ("Vacant", "Available", "Needs
Cleaning") breaks for a marina set up in another language; that is
pre-existing and also in the ROADMAP.
