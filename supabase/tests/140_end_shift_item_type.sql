-- Test 8 of the approved list for the End Shift Item: the new item type is
-- accepted, and the type list still rejects what it doesn't name.
create extension if not exists pgtap;
begin;
select plan(2);

insert into roles (id, name) values ('11111111-0000-4000-8000-0000000000e1', 'End Shift Fixture Role');
insert into checklist_templates (id, name, trigger_type, assigned_role_id) values
  ('22222222-0000-4000-8000-0000000000e1', 'End Shift Fixture', 'manual', '11111111-0000-4000-8000-0000000000e1');
insert into checklist_template_sections (id, template_id, name) values
  ('33333333-0000-4000-8000-0000000000e1', '22222222-0000-4000-8000-0000000000e1', 'Closing up');

select lives_ok(
  $$insert into checklist_template_items (id, section_id, type, label)
    values ('44444444-0000-4000-8000-0000000000e1', '33333333-0000-4000-8000-0000000000e1', 'end_shift', 'End Shift')$$,
  'a template item of type end_shift inserts');
select throws_ok(
  $$insert into checklist_template_items (id, section_id, type, label)
    values ('44444444-0000-4000-8000-0000000000e2', '33333333-0000-4000-8000-0000000000e1', 'clock_out_now', 'Nope')$$,
  '22P02',
  null,
  'an item type the list does not name is still rejected');

select * from finish();
rollback;
