-- Rollback for 0053. Removes the migrated deposit payment rows.
--
-- ONLY safe together with reverting the code change — lib.js owing() must go back
-- to `total - deposit - payments`. Running this against the new code makes every
-- record with a deposit look UNPAID by that amount.
--
-- Removes only rows tagged "migrated":true, so any genuine payment recorded since
-- the migration is untouched.

update public.estimates
   set payments = coalesce((
         select jsonb_agg(p)
           from jsonb_array_elements(payments) p
          where coalesce((p->>'migrated')::boolean, false) is not true
       ), '[]'::jsonb)
 where payments @> '[{"migrated":true}]'::jsonb;

update public.jobs
   set payments = coalesce((
         select jsonb_agg(p)
           from jsonb_array_elements(payments) p
          where coalesce((p->>'migrated')::boolean, false) is not true
       ), '[]'::jsonb)
 where payments @> '[{"migrated":true}]'::jsonb;
