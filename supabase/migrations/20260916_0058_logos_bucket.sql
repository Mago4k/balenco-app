-- 0058 — give the company logo somewhere to live that is not the settings row.
--
-- THE PROBLEM
-- `settings.logo` holds a base64 data URI. Measured on the live database today:
--
--   settings table            321 kB
--   every other table together  11 kB
--   the whole gzipped app      135 kB
--
-- One contractor's 512x512 PNG, 240 kB on disk and 327 kB once base64'd, is the
-- single largest thing the app downloads — larger than the app itself — and it is
-- fetched on EVERY boot, because settings is one of the tables fetchState() pulls
-- at startup. It is also inlined into every estimate email, where some clients
-- strip data: URIs outright.
--
-- THE FIX
-- A public `logos` bucket, one folder per org. `settings.logo` keeps its name and
-- its meaning — "what to put in an <img src>" — and simply starts holding an https
-- URL instead of 327 kB of base64. Every consumer (the settings preview, estimate
-- HTML, printed invoices, the client portal, the booking page, and the three edge
-- functions that email a logo) already does `<img src="${cfg.logo}">`, so none of
-- them need to change, and existing data: URIs keep rendering untouched while orgs
-- migrate one re-upload at a time.
--
-- PUBLIC, not signed. A signed URL expires; a quote emailed in March gets opened in
-- June, and the logo has to still be there. It is also on every public portal and
-- booking page already, so there is nothing to protect — the bucket is public READ
-- only, and writes are locked down below.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logos', 'logos', true, 2097152,
        array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/svg+xml'];

-- Same folder-per-org shape the photos bucket uses, so there is one rule to learn.
-- Writes additionally require owner/admin, matching settings_admin_write: an
-- employee must not be able to swap the mark that goes out on every quote, invoice
-- and email the company sends.
drop policy if exists logos_public_read on storage.objects;
create policy logos_public_read on storage.objects
  for select to public
  using (bucket_id = 'logos');

drop policy if exists logos_admin_insert on storage.objects;
create policy logos_admin_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = (current_org_id())::text
    and current_user_role() = any (array['owner','admin'])
  );

drop policy if exists logos_admin_update on storage.objects;
create policy logos_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = (current_org_id())::text
    and current_user_role() = any (array['owner','admin'])
  );

drop policy if exists logos_admin_delete on storage.objects;
create policy logos_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = (current_org_id())::text
    and current_user_role() = any (array['owner','admin'])
  );
