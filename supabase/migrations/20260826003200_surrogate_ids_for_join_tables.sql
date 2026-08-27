-- Every synced table needs its own `id`, because PowerSync rows are keyed by one.
--
-- PowerSync identifies a row by a single `id` column. Sixteen tables here had
-- no such column — fifteen junction tables keyed on the pair they join, plus
-- contact_details, keyed on the contact it extends. Replication still worked:
-- PowerSync synthesises an id by hashing the replica identity, which is why
-- this went unnoticed while only reads were being verified.
--
-- Reads are the half that works. The write path is the half that does not:
--
--   * An INSERT arrives at PostgREST carrying that synthetic id, which is not
--     a column, so it is rejected.
--   * A DELETE carries the id and NOTHING ELSE — PowerSync sends no row data
--     for a delete. A hash cannot be turned back into (boat_id, contact_id),
--     so the delete has no target.
--
-- Assigning an owner to a boat, adding a lessee to a lease, putting a user in
-- a chat room, granting a role — every one of those is a write to a table in
-- that list. So this is not a tidiness migration; without it the rewrite has
-- no way to say most of what the app says.
--
-- The alternative PowerSync documents is to alias a composite id in the sync
-- rules (`SELECT a || '_' || b AS id, *`) and split it apart again on upload.
-- Rejected: it puts a per-table decode table in the write path, and a wrong
-- entry there fails as a silent no-op rather than an error. A real column
-- keeps the upload connector a single uniform function for all 62 tables.
--
-- The old primary key becomes a UNIQUE constraint, so nothing that could not
-- be duplicated before can be duplicated now, and `on conflict` clauses that
-- name those columns (the seed loader, refresh_user_permissions) keep working
-- against the unique index instead of the primary one.
--
-- After applying: `pnpm run ps:reset`. Replicated rows are keyed by the old
-- synthetic ids, and nothing rewrites them in place.
do $$
declare
  spec text[][] := array[
    ['boat_authorized_users',        'boat_id,contact_id'],
    ['boat_owners',                  'boat_id,contact_id'],
    ['chat_message_attachments',     'message_id,attachment_id'],
    ['chat_room_roles',              'room_id,role_id'],
    ['chat_room_users',              'room_id,user_id'],
    ['contact_details',              'contact_id'],
    ['lease_documents',              'lease_id,attachment_id'],
    ['lease_lessees',                'lease_id,contact_id'],
    ['location_type_parents',        'parent_type_id,child_type_id'],
    ['template_section_assets',      'section_id,asset_id'],
    ['template_section_checkpoints', 'section_id,checkpoint_id'],
    ['template_viewer_roles',        'template_id,role_id'],
    ['tour_checkpoints',             'tour_id,checkpoint_id'],
    ['user_permissions',             'user_id,permission'],
    ['user_roles',                   'user_id,role_id'],
    ['vehicle_owners',               'vehicle_id,contact_id']
  ];
  tbl  text;
  cols text;
  i    int;
begin
  for i in 1 .. array_length(spec, 1) loop
    tbl  := spec[i][1];
    cols := spec[i][2];

    execute format(
      'alter table public.%I add column id uuid not null default gen_random_uuid()', tbl);
    execute format(
      'alter table public.%I drop constraint %I', tbl, tbl || '_pkey');
    execute format(
      'alter table public.%I add constraint %I primary key (id)', tbl, tbl || '_pkey');
    execute format(
      'alter table public.%I add constraint %I unique (%s)',
      tbl, tbl || '_key', cols);
  end loop;
end $$;
