-- ============================================================
-- Balenco — migration 15: make the photos bucket private.
-- Job photos can show the inside of clients' homes; a public bucket
-- means anyone with the URL can view them. The app now serves photos
-- through short-lived signed URLs instead. (Bucket is empty today, so
-- there is nothing to migrate.)
-- ============================================================
update storage.buckets set public = false where id = 'photos';
