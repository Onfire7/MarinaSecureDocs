-- People & access.
--
-- Two structures from the InstantDB schema are deliberately absent:
--   * $users / the userAuth link — users.clerk_user_id is the identity join.
--   * users.can_manage_roles / can_manage_users — denormalised booleans that
--     existed only because a rule engine could reach one scalar in one hop.
--     A view can join; see 1400_auth_functions.sql.

create table users (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  email          text unique,
  phone          text,
  -- The join RLS uses: current_marina_user_id() resolves auth.jwt()->>'sub'
  -- through this column.
  clerk_user_id  text unique,
  active         boolean not null default true,
  -- Ordered [{card, visible}] pairs; null = derive from current roles.
  -- Genuinely per-user UI state, so it stays jsonb.
  dashboard_layout jsonb,
  created_at     timestamptz not null default now()
);
create index users_clerk_user_id_idx on users (clerk_user_id) where clerk_user_id is not null;

create table roles (
  id     uuid primary key default gen_random_uuid(),
  name   text not null,
  -- Permission keys granted / explicitly denied. Absent from both = Undefined.
  -- text[] rather than jsonb: the effective_permissions view unnests these.
  allow  text[] not null default '{}',
  deny   text[] not null default '{}'
);

-- Role assignment is a row here, not a link on a user. That is what closes the
-- privilege-escalation vector in ADR 0002: granting yourself a role is an
-- INSERT into a table with its own policy, requiring manage_roles. There is no
-- per-entity update that reaches it.
create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (user_id, role_id)
);
create index user_roles_role_id_idx on user_roles (role_id);
