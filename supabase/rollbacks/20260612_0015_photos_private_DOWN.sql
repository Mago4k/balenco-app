-- Rollback migration 15.
update storage.buckets set public = true where id = 'photos';
