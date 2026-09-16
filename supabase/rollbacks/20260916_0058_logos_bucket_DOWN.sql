-- Rollback for 0058. Drops the policies and the bucket. Any settings.logo that
-- already holds a storage URL will 404 afterwards, so re-upload those logos (the
-- app still accepts a data: URI) before running this.
drop policy if exists logos_public_read  on storage.objects;
drop policy if exists logos_admin_insert on storage.objects;
drop policy if exists logos_admin_update on storage.objects;
drop policy if exists logos_admin_delete on storage.objects;
delete from storage.objects where bucket_id = 'logos';
delete from storage.buckets where id = 'logos';
