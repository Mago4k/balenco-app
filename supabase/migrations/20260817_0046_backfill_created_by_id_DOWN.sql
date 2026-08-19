-- DOWN for migration 46. Clears the backfilled ownership ids but leaves the
-- columns in place. Only safe before the policy flip (0048) — after it, this
-- would make every record owner-only.

update public.clients      set created_by_id = null;
update public.leads        set created_by_id = null;
update public.estimates    set created_by_id = null;
update public.appointments set created_by_id = null;
update public.photos       set created_by_id = null;
update public.jobs         set created_by_id = null;
update public.logs         set user_id       = null;
