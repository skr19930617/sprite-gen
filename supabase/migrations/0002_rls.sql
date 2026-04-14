-- 0002_rls.sql
-- Row-Level Security policies. Every app table requires user_id = auth.uid().
-- plan_changes is service-role-only (Stripe webhook).

-- ============================================================
-- profiles
-- ============================================================
alter table profiles enable row level security;

drop policy if exists "profiles_select_own" on profiles;
create policy "profiles_select_own"
  on profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- INSERT happens via auth trigger (security definer); no user-facing INSERT policy.
-- DELETE cascades from auth.users; no user-facing DELETE policy.

-- ============================================================
-- drafts
-- ============================================================
alter table drafts enable row level security;

drop policy if exists "drafts_select_own" on drafts;
create policy "drafts_select_own"
  on drafts for select
  using (auth.uid() = user_id);

drop policy if exists "drafts_insert_own" on drafts;
create policy "drafts_insert_own"
  on drafts for insert
  with check (auth.uid() = user_id);

drop policy if exists "drafts_update_own" on drafts;
create policy "drafts_update_own"
  on drafts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "drafts_delete_own" on drafts;
create policy "drafts_delete_own"
  on drafts for delete
  using (auth.uid() = user_id);

-- ============================================================
-- projects
-- ============================================================
alter table projects enable row level security;

drop policy if exists "projects_select_own" on projects;
create policy "projects_select_own"
  on projects for select
  using (auth.uid() = user_id);

drop policy if exists "projects_insert_own" on projects;
create policy "projects_insert_own"
  on projects for insert
  with check (auth.uid() = user_id);

drop policy if exists "projects_update_own" on projects;
create policy "projects_update_own"
  on projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "projects_delete_own" on projects;
create policy "projects_delete_own"
  on projects for delete
  using (auth.uid() = user_id);

-- ============================================================
-- generations
-- Read own; insert restricted to service role (server-side route handler
-- that has been authorized; uses service role to insert with arbitrary user_id).
-- ============================================================
alter table generations enable row level security;

drop policy if exists "generations_select_own" on generations;
create policy "generations_select_own"
  on generations for select
  using (auth.uid() = user_id);

-- No INSERT/UPDATE/DELETE policy: only service role may modify generations
-- (called from the /api/generate route handler with the service-role client).

-- ============================================================
-- plan_changes
-- Read own; only service role inserts (Stripe webhook with idempotency).
-- ============================================================
alter table plan_changes enable row level security;

drop policy if exists "plan_changes_select_own" on plan_changes;
create policy "plan_changes_select_own"
  on plan_changes for select
  using (auth.uid() = user_id);

-- No INSERT policy: only service role inserts plan_changes rows.
