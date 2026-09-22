-- Checklist templates and their materialised instances.
--
-- Instances are fully materialised copies: every section and item exists as a
-- row from the moment it is assigned, so display logic only ever renders rows.
-- Trigger rules decide IF a row is created; hide_until decides WHEN it becomes
-- visible — and once visible, nothing ever re-hides.

create table checklist_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  trigger_type     template_trigger not null,
  -- recurring: {recurrenceRule: RRULE}. Genuinely shape-varying, so jsonb.
  trigger_config   jsonb,
  -- Every template belongs to exactly one role; its holders work the
  -- instances. There is no global or personal visibility.
  assigned_role_id uuid not null references roles(id) on delete cascade,
  -- true: assigned to whoever triggered it. false: unclaimed, for any holder
  -- of assigned_role to pick up.
  assigned_to_user boolean not null default false,
  -- "HH:MM", resolved to instance.hide_until at creation.
  hide_until_rule  text,
  -- {kind:"time",time} | {kind:"offset",minutes}, resolved at creation.
  due_by           jsonb,
  creator_id       uuid references users(id)
);

-- Read-only cross-role monitoring: office watching maintenance's progress
-- without holding the role.
create table template_viewer_roles (
  template_id uuid not null references checklist_templates(id) on delete cascade,
  role_id     uuid not null references roles(id) on delete cascade,
  primary key (template_id, role_id)
);

create table checklist_template_sections (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references checklist_templates(id) on delete cascade,
  name            text not null,
  position        integer not null default 0,
  -- Authoring switch: inactive sections are never instantiated.
  is_active       boolean not null default true,
  trigger_type    section_trigger not null default 'manual',
  trigger_config  jsonb,
  hide_until_rule text,
  due_by          jsonb,
  location_id     uuid references locations(id) on delete set null
);
create index checklist_template_sections_template_idx on checklist_template_sections (template_id, position);

create table template_section_checkpoints (
  section_id    uuid not null references checklist_template_sections(id) on delete cascade,
  checkpoint_id uuid not null references checkpoints(id) on delete cascade,
  primary key (section_id, checkpoint_id)
);

create table template_section_assets (
  section_id uuid not null references checklist_template_sections(id) on delete cascade,
  asset_id   uuid not null references assets(id) on delete cascade,
  primary key (section_id, asset_id)
);

-- Copy-on-edit. Committing an edit writes a NEW row and repoints the section,
-- so instance items forever reference the exact row they were created from
-- without snapshotting config per instance. There is no forward "current"
-- pointer: the live version is whichever row the section points at.
create table checklist_template_items (
  id                  uuid primary key default gen_random_uuid(),
  section_id          uuid not null references checklist_template_sections(id) on delete cascade,
  type                checklist_item_type not null,
  label               text not null,
  config              jsonb,
  position            integer not null default 0,
  version             integer not null default 1,
  previous_version_id uuid references checklist_template_items(id) on delete set null
);
create index checklist_template_items_section_idx on checklist_template_items (section_id, position);

create table checklist_instances (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid references checklist_templates(id) on delete set null,
  assigned_to_id uuid references users(id) on delete set null,
  status         checklist_status not null default 'not_started',
  started_at     timestamptz,
  completed_at   timestamptz,
  -- Absent or past = visible.
  hide_until     timestamptz,
  due_by         timestamptz,
  -- Set only on nested instances spawned by a location_check item. The
  -- checklist list shows instances where this is null, so sub-checklists do
  -- not double-list. FK added in 1100 once instance items exist.
  parent_item_id uuid
);
create index checklist_instances_status_idx on checklist_instances (status);
create index checklist_instances_due_idx on checklist_instances (due_by);

create table checklist_instance_sections (
  id                  uuid primary key default gen_random_uuid(),
  instance_id         uuid not null references checklist_instances(id) on delete cascade,
  template_section_id uuid references checklist_template_sections(id) on delete set null,
  -- Copied from the template section's name at creation.
  label               text not null,
  position            integer not null default 0,
  hide_until          timestamptz,
  due_by              timestamptz,
  location_id         uuid references locations(id) on delete set null
);
create index checklist_instance_sections_instance_idx on checklist_instance_sections (instance_id, position);

create table checklist_instance_items (
  id               uuid primary key default gen_random_uuid(),
  section_id       uuid not null references checklist_instance_sections(id) on delete cascade,
  -- Pins the exact item VERSION this row was created from; label, type and
  -- config are always read through here, never copied.
  template_item_id uuid not null references checklist_template_items(id),
  position         integer not null default 0,
  completed_at     timestamptz,
  completed_by_id  uuid references users(id),
  -- Shape varies by item type, so jsonb.
  result           jsonb,
  note             text
);
create index checklist_instance_items_section_idx on checklist_instance_items (section_id, position);

alter table checklist_instances
  add constraint checklist_instances_parent_item_fk
  foreign key (parent_item_id) references checklist_instance_items(id) on delete cascade;
