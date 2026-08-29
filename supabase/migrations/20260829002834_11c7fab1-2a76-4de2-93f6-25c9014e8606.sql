-- 1. Pin search_path and lock down anon EXECUTE on the three execution-lease routines.
alter function public.claim_case_for_execution(uuid, integer, text) set search_path = public, pg_temp;
alter function public.claim_next_queued_case(integer, text) set search_path = public, pg_temp;
alter function public.renew_execution_lease(uuid, uuid, integer) set search_path = public, pg_temp;

revoke all on function public.claim_case_for_execution(uuid, integer, text) from public, anon;
revoke all on function public.claim_next_queued_case(integer, text) from public, anon;
revoke all on function public.renew_execution_lease(uuid, uuid, integer) from public, anon;

grant execute on function public.claim_case_for_execution(uuid, integer, text) to authenticated, service_role;
grant execute on function public.claim_next_queued_case(integer, text) to authenticated, service_role;
grant execute on function public.renew_execution_lease(uuid, uuid, integer) to authenticated, service_role;

-- 2. Remove duplicate overlapping case-files storage policies, keeping one canonical
--    owner-scoped set (owner folder, admin read/delete).
drop policy if exists "case-files: users delete own" on storage.objects;
drop policy if exists "case-files: users insert own" on storage.objects;
drop policy if exists "case-files: users read own" on storage.objects;
drop policy if exists "case-files: users update own" on storage.objects;
drop policy if exists "Users can update their own case files" on storage.objects;

drop policy if exists "case files own update" on storage.objects;
create policy "case files own update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'case-files'
    and (auth.uid())::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'case-files'
    and (auth.uid())::text = (storage.foldername(name))[1]
  );