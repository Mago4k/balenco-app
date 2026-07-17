-- ============================================================
-- Security audit remediation (2026-06-25) — applied live via MCP.
--
-- #8  Remove the internal trigger-helper functions from the anon/authenticated
--     RPC surface. They are trigger functions (need no direct EXECUTE), and the
--     Supabase linter flagged them as callable via /rest/v1/rpc. Revoking from
--     PUBLIC is required because anon/authenticated inherit PUBLIC grants;
--     trigger firing is unaffected (it doesn't check EXECUTE privilege).
--
-- #10 Replace the leftover role=public "Users can update own profile" policy
--     with a properly scoped authenticated policy + explicit WITH CHECK.
--     guard_profile_update() still reverts role/org_id escalation attempts.
-- ============================================================

revoke execute on function public.create_trial_subscription() from public, anon, authenticated;
revoke execute on function public.assign_job_number()        from public, anon, authenticated;

drop policy if exists "Users can update own profile" on public.profiles;
create policy "users_update_own_profile" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
