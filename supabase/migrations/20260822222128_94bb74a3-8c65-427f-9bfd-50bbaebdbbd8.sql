-- Finding 5: SUPA_anon_security_definer_function_executable
-- Finding 6: SUPA_function_search_path_mutable
-- Idempotent: safe to re-run.

-- 6. Pin search_path on every project function that lacks one.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f','p')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
      and (p.proconfig is null or not (p.proconfig::text like '%search_path%'))
  loop
    execute format('alter function %s set search_path = public, pg_temp', r.sig);
  end loop;
end $$;

-- 5. Revoke PUBLIC/anon EXECUTE everywhere; re-grant only the exact roles
--    that can call the routine today. Trigger routines get no client grant.
do $$
declare
  r record;
  keep_authenticated boolean;
  is_trigger boolean;
begin
  for r in
    select p.oid, p.oid::regprocedure as sig, p.prorettype
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f','p')
      and not exists (
        select 1 from pg_depend d
        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
      )
  loop
    is_trigger := r.prorettype = 'trigger'::regtype;
    keep_authenticated := has_function_privilege('authenticated', r.oid, 'execute');

    execute format('revoke all on function %s from public', r.sig);
    execute format('revoke all on function %s from anon', r.sig);

    if is_trigger then
      execute format('revoke all on function %s from authenticated', r.sig);
    elsif keep_authenticated then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;

    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;

-- The public pricing helper is the one deliberate anonymous entry point.
grant execute on function public.list_public_billing_plans() to anon;