-- ============================================================
-- Balenco — migration 8: stop anonymous LISTING of the public photos bucket
-- (advisor lint 0025). The bucket stays public, so existing <img> public URLs
-- keep working — this only removes the broad SELECT policy that let anyone
-- enumerate every file in the bucket.
-- ============================================================
drop policy if exists "Anyone can view photos" on storage.objects;
