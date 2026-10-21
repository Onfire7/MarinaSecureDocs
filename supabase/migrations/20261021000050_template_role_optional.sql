-- A checklist template outlives its role.
--
-- assigned_role_id was NOT NULL with ON DELETE CASCADE, which meant two
-- things: a template could not be saved before its role was chosen (the
-- editor creates the row first and asks for the role on the next screen, so
-- every new template was refused and rolled back), and deleting a role
-- silently deleted every template on it. Now it is optional and a deleted
-- role leaves its templates behind without one, for an admin to reassign
-- rather than rebuild — deleting a role stays a one-place action.
--
-- Nothing in the database reads this column: no policy, sync stream or
-- function. A template with no role is a draft in effect — no manual start
-- list, home card or End of Shift offers it, and any checklist another
-- trigger creates from it goes to whoever triggered it
-- (src/data/checklistInstantiation.ts).

alter table checklist_templates
  alter column assigned_role_id drop not null,
  drop constraint checklist_templates_assigned_role_id_fkey,
  add constraint checklist_templates_assigned_role_id_fkey
    foreign key (assigned_role_id) references roles(id) on delete set null;
