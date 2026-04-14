-- 0003_storage.sql
-- Private Storage bucket for project artifacts.
-- Path layout enforced by application:
--   {user_id}/drafts/{draft_id}/{source.png|mask.png|result.gif|spritesheet.png|project.json}
--   {user_id}/projects/{project_id}/{source.png|mask.png|result.gif|spritesheet.png|project.json}
-- The first path segment is the owning user's id; RLS gates access by that prefix.

insert into storage.buckets (id, name, public)
values ('projects', 'projects', false)
on conflict (id) do nothing;

-- Storage RLS: users can only access objects under their own user_id prefix.
drop policy if exists "projects_storage_select_own" on storage.objects;
create policy "projects_storage_select_own"
  on storage.objects for select
  using (
    bucket_id = 'projects'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "projects_storage_insert_own" on storage.objects;
create policy "projects_storage_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'projects'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "projects_storage_update_own" on storage.objects;
create policy "projects_storage_update_own"
  on storage.objects for update
  using (
    bucket_id = 'projects'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'projects'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "projects_storage_delete_own" on storage.objects;
create policy "projects_storage_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'projects'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
