-- Reverse of 20260625_0032 (restores prior state).
drop policy if exists "users_update_own_profile" on public.profiles;
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

grant execute on function public.create_trial_subscription() to public;
grant execute on function public.assign_job_number()        to public;
