# Supabase migrations

Migrations are applied in numeric order via the Supabase CLI:

```bash
supabase db push          # against the linked project
supabase db reset         # local dev: drop + apply all migrations + seed.sql
```

| File                          | Purpose                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `migrations/0001_init.sql`    | Tables: `profiles`, `drafts`, `projects`, `generations`, `plan_changes` + auth-user trigger |
| `migrations/0002_rls.sql`     | Row-Level Security policies for every app table                                             |
| `migrations/0003_storage.sql` | Private `projects` bucket and ownership-prefix RLS                                          |
| `seed.sql`                    | Optional local dev seed data (not run in production)                                        |

## Storage layout

All artifacts live under the `projects` bucket. The first path segment is the owning user's UUID; the storage RLS policy enforces this prefix:

```
{user_id}/drafts/{draft_id}/source.png
{user_id}/drafts/{draft_id}/mask.png
{user_id}/drafts/{draft_id}/result.gif
{user_id}/drafts/{draft_id}/spritesheet.png
{user_id}/drafts/{draft_id}/project.json

{user_id}/projects/{project_id}/source.png
... (same artifact set, after explicit save)
```

## Tasks 2.1 and 2.6 (manual, external)

`2.1 Create Supabase project (dev + prod) and record project refs` and
`2.6 Verify migrations apply cleanly on a fresh Supabase project` require a
Supabase account and are not part of this codebase change. Once the project is
provisioned and `supabase link` has connected this repo to it, run
`supabase db push` to apply the migrations above.
