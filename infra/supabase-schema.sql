-- Hermes deployer — agent store (replaces the local JSON file).
-- Run this in the Supabase SQL editor (or via psql) once.

create table if not exists agents (
  tenant_id       text primary key,
  user_id         text not null,
  name            text not null,
  url             text not null default '',
  status          text not null default 'provisioning',
  channel         text not null default 'web',
  -- runtime metadata (nullable: differs local vs AWS)
  task_arn        text,
  api_port        integer,
  dashboard_port  integer,
  secret_arn      text,
  access_point_id text,
  security_group_id text,
  personality_id  text,
  created_at      timestamptz not null default now()
);

-- Fast lookups by owner (the dashboard lists a user's agents).
create index if not exists agents_user_id_idx on agents (user_id);

-- The app + the Telegram gateway use the SERVICE key (server-side only), so
-- row-level security is bypassed by design — ownership is enforced in app code
-- (getOwned checks user_id). Enable RLS + policies later if clients ever read
-- this table directly.
