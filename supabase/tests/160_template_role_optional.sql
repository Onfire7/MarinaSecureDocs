-- A checklist template outlives its role (migration
-- 20261021000050_template_role_optional): it can be saved before a role is
-- chosen, and deleting a role leaves its templates — and everything in them —
-- behind with no role, for an admin to reassign.
create extension if not exists pgtap;
begin;
select plan(4);

insert into roles (id, name) values ('11111111-0000-4000-8000-0000000001a1', 'Role Optional Fixture Role');
insert into checklist_templates (id, name, trigger_type, assigned_role_id) values
  ('22222222-0000-4000-8000-0000000001a1', 'Role Optional Fixture', 'manual', '11111111-0000-4000-8000-0000000001a1');
insert into checklist_template_sections (id, template_id, name) values
  ('33333333-0000-4000-8000-0000000001a1', '22222222-0000-4000-8000-0000000001a1', 'Opening up');
insert into checklist_template_items (id, section_id, type, label) values
  ('44444444-0000-4000-8000-0000000001a1', '33333333-0000-4000-8000-0000000001a1', 'simple_check', 'Lights on');

select lives_ok(
  $$insert into checklist_templates (id, name, trigger_type)
    values ('22222222-0000-4000-8000-0000000001a2', 'New template', 'manual')$$,
  'a template saves without a role');

delete from roles where id = '11111111-0000-4000-8000-0000000001a1';

select is(
  (select count(*)::int from checklist_templates where id = '22222222-0000-4000-8000-0000000001a1'),
  1,
  'deleting a role keeps its templates');
select is(
  (select assigned_role_id from checklist_templates where id = '22222222-0000-4000-8000-0000000001a1'),
  null,
  '...and clears their role');
select is(
  (select count(*)::int from checklist_template_items i
     join checklist_template_sections s on s.id = i.section_id
    where s.template_id = '22222222-0000-4000-8000-0000000001a1'),
  1,
  'the template''s sections and items survive the role''s deletion');

select * from finish();
rollback;
