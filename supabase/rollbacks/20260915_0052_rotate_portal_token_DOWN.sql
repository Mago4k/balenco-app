-- Rollback for 0052. Removes the ability to revoke a client's portal link.
--
-- Safe in the sense that nothing depends on it structurally: the frontend calls
-- this RPC only from the "Reset link" action, which will then surface an error
-- toast instead of rotating. Tokens already rotated stay rotated — the old links
-- do not come back.

drop function if exists public.rotate_portal_token(uuid);
