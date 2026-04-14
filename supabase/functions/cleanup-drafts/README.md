# cleanup-drafts

Deletes `drafts` rows (and Storage artifacts under `{user_id}/drafts/{draft_id}/`) older than 24 hours.

## Deploy

```bash
supabase functions deploy cleanup-drafts --no-verify-jwt
```

## Schedule (Supabase Dashboard → Database → Cron Jobs)

```sql
select cron.schedule(
  'cleanup-drafts-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/cleanup-drafts',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'))
  );
  $$
);
```

Or trigger manually:

```bash
curl -X POST https://<PROJECT_REF>.supabase.co/functions/v1/cleanup-drafts \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

## Behaviour

- Idempotent: safe to run repeatedly.
- Deletes Storage objects first, then DB rows (partial-run safe).
- Cleans `source.png`, `mask.png`, `result.gif`, `spritesheet.png`, `project.json`.
- 200-row batches.
