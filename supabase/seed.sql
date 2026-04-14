-- seed.sql
-- Optional local development seed.
-- Production deployments do not run this file.
-- The auth trigger (tg__handle_new_user) creates profile rows automatically
-- when users sign up, so no manual profile inserts are needed here.

-- Example: pre-populate plan_changes audit row for a known test user.
-- Uncomment and replace the uuid with a real auth.users.id from your local
-- Supabase instance.

-- insert into plan_changes (user_id, from_plan, to_plan, stripe_event_id)
-- values ('00000000-0000-0000-0000-000000000000', 'free', 'paid', 'evt_seed_local')
-- on conflict (stripe_event_id) do nothing;
