# Rollback scripts — NOT migrations

These used to live in `supabase/migrations/` alongside the forward migrations.
They were moved out on 2026-09-14 because they are **dangerous where they were**.

## Why they moved

The Supabase CLI treats every `.sql` file in `supabase/migrations/` as a forward
migration and orders them by the leading numeric token in the filename. These
files share that exact shape (`20260611_0002_tenant_isolation_DOWN.sql`), so a
`supabase db push` would have **applied the rollbacks as if they were
migrations**, newest-first, straight into the database.

That is not theoretical. `20260611_0002_tenant_isolation_DOWN.sql` contains:

```sql
create policy "auth_all" on public.clients      for all to authenticated using (true) with check (true);
create policy "auth_all" on public.leads        for all to authenticated using (true) with check (true);
create policy "auth_all" on public.estimates    for all to authenticated using (true) with check (true);
-- ...and the same for appointments, photos, logs
```

Running it grants **every authenticated user full read/write on every row of
every tenant**. Migration 0002 exists specifically to destroy those policies.
Several other DOWN files are comparably destructive — `0046_..._DOWN.sql` blanks
every `created_by_id`, and `0049_..._DOWN.sql` reverts record ownership to the
display-name model.

## How to use one

Never in bulk, and never through the CLI. Open the file, read the header (each
one states what it reverts and what it re-opens), and run that single script
deliberately — via the dashboard SQL editor or the MCP tool — against the
database you mean.

Each rollback's matching forward migration is the same filename without the
`_DOWN` suffix, in `../migrations/`.
