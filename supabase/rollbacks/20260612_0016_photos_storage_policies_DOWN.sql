-- Rollback migration 16: restore the old un-scoped policies.
drop policy if exists "photos_org_select" on storage.objects;
drop policy if exists "photos_org_insert" on storage.objects;
drop policy if exists "photos_org_delete" on storage.objects;

create policy "Authenticated users can upload photos" on storage.objects for insert
  with check (bucket_id = 'photos' and auth.role() = 'authenticated');
create policy "Authenticated users can delete photos" on storage.objects for delete
  using (bucket_id = 'photos' and auth.role() = 'authenticated');
