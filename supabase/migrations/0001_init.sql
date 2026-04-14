-- 0001_init.sql
-- Initial schema for Sprite Generator MVP.
-- Supabase Auth provides auth.users; this migration adds app tables.

create extension if not exists "pgcrypto";

-- ============================================================
-- profiles: app-specific user metadata + plan state
-- ============================================================
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'paid')),
  stripe_customer_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.tg__set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
  before update on profiles
  for each row
  execute function public.tg__set_updated_at();

-- Auto-create profile row on new auth.users insertion.
create or replace function public.tg__handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.tg__handle_new_user();

-- ============================================================
-- drafts: in-progress sessions before user explicitly saves
-- ============================================================
create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  prompt text not null,
  llm_result jsonb,
  final_animation_type text check (
    final_animation_type in ('swim_slow', 'turn', 'approach_food', 'eat')
  ),
  final_params jsonb,
  source_path text not null,
  mask_path text,
  gif_path text,
  spritesheet_path text,
  project_json_path text,
  -- non-null when the draft was hydrated from a saved project (regenerate / edit flow).
  -- The FK is added later (deferred) to break the projects <-> drafts circular reference.
  originating_project_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists drafts_user_id_idx
  on drafts (user_id, updated_at desc);

create index if not exists drafts_cleanup_idx
  on drafts (updated_at);

create index if not exists drafts_originating_project_idx
  on drafts (originating_project_id)
  where originating_project_id is not null;

drop trigger if exists drafts_set_updated_at on drafts;
create trigger drafts_set_updated_at
  before update on drafts
  for each row
  execute function public.tg__set_updated_at();

-- ============================================================
-- projects: explicitly saved projects (consume save quota)
-- ============================================================
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  prompt text not null,
  final_animation_type text not null check (
    final_animation_type in ('swim_slow', 'turn', 'approach_food', 'eat')
  ),
  renderer_version int not null default 1,
  source_path text not null,
  mask_path text not null,
  project_json_path text not null,
  gif_path text,
  spritesheet_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_id_idx
  on projects (user_id, updated_at desc);

drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at
  before update on projects
  for each row
  execute function public.tg__set_updated_at();

-- Add deferred FK from drafts.originating_project_id -> projects.id now that
-- projects exists. ON DELETE SET NULL so saved-project deletion doesn't
-- cascade to in-flight edits.
alter table drafts
  drop constraint if exists drafts_originating_project_id_fkey;
alter table drafts
  add constraint drafts_originating_project_id_fkey
  foreign key (originating_project_id) references projects (id) on delete set null;

-- ============================================================
-- generations: audit + monthly quota counter source
-- ============================================================
create table if not exists generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references projects (id) on delete set null,
  draft_id uuid references drafts (id) on delete set null,
  status text not null check (status in ('success', 'failed', 'timeout')),
  counted boolean not null default false,
  error_code text,
  created_at timestamptz not null default now()
);

-- Use plain (user_id, created_at) so the partial-index predicate stays IMMUTABLE
-- (date_trunc on timestamptz is only STABLE). Monthly bucketing is computed in
-- the WHERE clause: created_at >= date_trunc('month', now()).
create index if not exists generations_user_counted_idx
  on generations (user_id, created_at desc)
  where status = 'success' and counted = true;

create index if not exists generations_user_recent_idx
  on generations (user_id, created_at desc);

-- ============================================================
-- plan_changes: audit log for billing transitions
-- ============================================================
create table if not exists plan_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_plan text not null,
  to_plan text not null,
  stripe_event_id text unique,
  occurred_at timestamptz not null default now()
);

create index if not exists plan_changes_user_recent_idx
  on plan_changes (user_id, occurred_at desc);
