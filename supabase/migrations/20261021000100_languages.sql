-- Languages (docs/localization.md, ADR 0009).
--
-- users.language is the UI language a person chose for themselves; null
-- means "follow the device". marina_settings.language is the language the
-- app writes into this marina's records — Activity Log summaries,
-- auto-raised ticket titles, default names — whoever is signed in.
--
-- Which codes are *available* is the app's business: a code is valid when
-- src/i18n/locales/ has a catalog for it, and the app falls back to English
-- for one that does not. So the database checks only the shape, and a new
-- language never needs a migration.
--
-- users.language needs no policy of its own: users_update already lets a
-- user edit their own row, and an admin with manage_users theirs.

alter table users
  add column language text
    constraint users_language_shape check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');

alter table marina_settings
  add column language text not null default 'en'
    constraint marina_settings_language_shape check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$');
