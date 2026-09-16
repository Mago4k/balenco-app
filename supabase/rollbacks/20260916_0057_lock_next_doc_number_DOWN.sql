-- Rollback for 0057. Re-exposes next_doc_number on the REST API, which is the
-- hole 0057 closed -- only do this if something outside the database turns out
-- to need it, and give it an org check first.
grant execute on function public.next_doc_number(uuid, text) to authenticated;
