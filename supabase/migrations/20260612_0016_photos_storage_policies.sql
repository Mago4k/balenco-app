-- ============================================================
-- Balenco — migration 16: org-scoped storage RLS for the photos bucket.
-- The bucket is now private (migration 15), so reads require a SELECT
-- policy for signed-URL generation. The old policies allowed ANY
-- authenticated user to upload/delete ANY photo (no SELECT at all).
-- New scheme: photo object paths are `<org_id>/<client_id>/<uuid>.jpg`,
-- so the first folder segment is the org. Scope all access to the
-- caller's own org. (Bucket is empty today — no objects to migrate.)
-- ============================================================

drop policy if exists "Authenticated users can upload photos" on storage.objects;
drop policy if exists "Authenticated users can delete photos" on storage.objects;
drop policy if exists "photos_org_select" on storage.objects;
drop policy if exists "photos_org_insert" on storage.objects;
drop policy if exists "photos_org_delete" on storage.objects;

create policy "photos_org_select" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = public.current_org_id()::text);

create policy "photos_org_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = public.current_org_id()::text);

create policy "photos_org_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = public.current_org_id()::text);
