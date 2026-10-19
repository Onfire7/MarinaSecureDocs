-- Template item versions, and the checklists that read through them.
--
-- A checklist item reads its label, type and config through the exact
-- template-item row it was made from, so that row must outlive every edit and
-- removal. The device decides "is anything still reading this?" from what it
-- holds, which is open checklists and the last 30 days, and so can ask to
-- DELETE a row an older checklist still reads. That delete used to be refused
-- (23503), discarded by the connector, and the row synced back into the
-- template beside its replacement: an edit duplicated the item, a removal was
-- undone. Postgres now orphans the row instead.
create extension if not exists pgtap;
begin;
select plan(6);

insert into roles (id, name) values ('11111111-0000-4000-8000-0000000000c1', 'Versions Fixture Role');
insert into checklist_templates (id, name, trigger_type, assigned_role_id) values
  ('22222222-0000-4000-8000-0000000000c1', 'Versions Fixture', 'manual', '11111111-0000-4000-8000-0000000000c1');
insert into checklist_template_sections (id, template_id, name) values
  ('33333333-0000-4000-8000-0000000000c1', '22222222-0000-4000-8000-0000000000c1', 'Dock');
insert into checklist_template_items (id, section_id, type, label) values
  ('44444444-0000-4000-8000-0000000000c1', '33333333-0000-4000-8000-0000000000c1', 'simple_check', 'Read by an old checklist'),
  ('44444444-0000-4000-8000-0000000000c2', '33333333-0000-4000-8000-0000000000c1', 'simple_check', 'Read by nothing');
insert into checklist_instances (id, template_id, status, completed_at) values
  ('55555555-0000-4000-8000-0000000000c1', '22222222-0000-4000-8000-0000000000c1', 'complete', now() - interval '45 days');
insert into checklist_instance_sections (id, instance_id, template_section_id, label) values
  ('66666666-0000-4000-8000-0000000000c1', '55555555-0000-4000-8000-0000000000c1', '33333333-0000-4000-8000-0000000000c1', 'Dock');
insert into checklist_instance_items (id, section_id, template_item_id, completed_at) values
  ('77777777-0000-4000-8000-0000000000c1', '66666666-0000-4000-8000-0000000000c1', '44444444-0000-4000-8000-0000000000c1', now() - interval '45 days');

-- 1-3. The bug. A delete of a row a checklist reads through succeeds, and
--      leaves the row in place, out of its section.
select lives_ok(
  $$delete from checklist_template_items where id = '44444444-0000-4000-8000-0000000000c1'$$,
  'deleting a template item an old checklist still reads is not refused');
select is(
  (select section_id from checklist_template_items where id = '44444444-0000-4000-8000-0000000000c1'),
  null,
  'the row survives the delete, orphaned from its section, so the template no longer lists it');
select is(
  (select ti.label from checklist_instance_items ii
     join checklist_template_items ti on ti.id = ii.template_item_id
    where ii.id = '77777777-0000-4000-8000-0000000000c1'),
  'Read by an old checklist',
  'the old checklist still reads the wording it was answered against');

-- 4. Orphaning must not become the only outcome, or nothing ever deletes.
delete from checklist_template_items where id = '44444444-0000-4000-8000-0000000000c2';
select is(
  (select count(*) from checklist_template_items where id = '44444444-0000-4000-8000-0000000000c2')::int, 0,
  'a template item nothing reads through is deleted outright');

-- 5-6. created_at: the client writes it, Postgres fills it in when omitted,
--      and rows from before the column existed are allowed to have none.
insert into checklist_instances (id, template_id) values
  ('55555555-0000-4000-8000-0000000000c2', '22222222-0000-4000-8000-0000000000c1');
insert into checklist_instance_sections (id, instance_id, label) values
  ('66666666-0000-4000-8000-0000000000c2', '55555555-0000-4000-8000-0000000000c2', 'Dock');
select ok(
  (select i.created_at is not null and s.created_at is not null
     from checklist_instances i
     join checklist_instance_sections s on s.instance_id = i.id
    where i.id = '55555555-0000-4000-8000-0000000000c2'),
  'an instance and a section inserted without created_at get one');
select ok(
  (select bool_and(is_nullable = 'YES') from information_schema.columns
    where table_schema = 'public' and column_name = 'created_at'
      and table_name in ('checklist_instances', 'checklist_instance_sections')),
  'created_at is nullable on both, so rows made before it existed need no backfill');

select * from finish();
rollback;
