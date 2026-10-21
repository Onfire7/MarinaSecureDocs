-- Languages (docs/localization.md § Two languages): users.language is the
-- UI language a user chose, null meaning "follow the device";
-- marina_settings.language is the language the app writes into the
-- database. Which codes exist is the app's business — a code is valid when
-- src/i18n/locales/ has a catalog for it — so the database checks only that
-- the value is shaped like a language code.
create extension if not exists pgtap;
begin;
select plan(9);

insert into users (id, name, clerk_user_id, active) values
  ('11111111-1111-1111-1111-111111111111', 'Alice — no roles', 'user_alice', true);

-- 1–3. A user sets, changes and clears their own language, through RLS.
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
update users set language = 'es' where id = '11111111-1111-1111-1111-111111111111';
reset role;
select is((select language from users where id = '11111111-1111-1111-1111-111111111111'), 'es',
  'a user can set their own language');

set local role authenticated;
update users set language = 'pt-BR' where id = '11111111-1111-1111-1111-111111111111';
reset role;
select is((select language from users where id = '11111111-1111-1111-1111-111111111111'), 'pt-BR',
  'any well-formed code is accepted, including a regional one with no catalog yet');

set local role authenticated;
update users set language = null where id = '11111111-1111-1111-1111-111111111111';
reset role;
select is((select language from users where id = '11111111-1111-1111-1111-111111111111'), null,
  'a user can clear their language back to "follow the device"');

-- 4–5. Junk is refused on both columns.
select throws_ok(
  $$update users set language = 'Spanish' where id = '11111111-1111-1111-1111-111111111111'$$,
  '23514', null, 'users.language refuses a value not shaped like a language code');

-- The seed loads a real settings row; work on whatever row is there.
delete from marina_settings;
insert into marina_settings (id, marina_name) values (1, 'Harborview');

select throws_ok(
  $$update marina_settings set language = 'en_US'$$,
  '23514', null, 'marina_settings.language refuses a value not shaped like a language code');

-- 6–7. The marina's language always has a value, English unless chosen.
select is((select language from marina_settings), 'en',
  'a marina is English until set otherwise');
select throws_ok(
  $$update marina_settings set language = null$$,
  '23502', null, 'marina_settings.language cannot be cleared');

-- 8–9. Any active marina user can read and change it — permissions on
-- settings are the app's (ADR 0002), as for every other setting.
select set_config('request.jwt.claims', '{"sub":"user_alice"}', true);
set local role authenticated;
update marina_settings set language = 'es';
select is((select language from marina_settings), 'es',
  'an active marina user can change the marina language, as with every setting');
reset role;

select set_config('request.jwt.claims', '{"sub":"user_nobody"}', true);
set local role authenticated;
select is((select count(*) from marina_settings where language is not null), 0::bigint,
  'an identity with no marina user sees no settings at all');
reset role;

select * from finish();
rollback;
