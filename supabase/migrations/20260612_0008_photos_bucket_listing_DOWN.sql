-- Rollback for migration 8 — restores the broad public listing policy.
create policy "Anyone can view photos" on storage.objects
  for select using (bucket_id = 'photos');
