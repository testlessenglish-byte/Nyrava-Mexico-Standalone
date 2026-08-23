-- Reversal for 20260823000000_care_intake_assignment_integrity.sql
-- Do not run after real intake records exist. This guard prevents data loss.
begin;

do $rollback_guard$
begin
  if to_regclass('public.social_intakes') is not null
    and exists(select 1 from public.social_intakes)
  then
    raise exception 'Rollback refused: social_intakes contains data. Preserve or migrate those records first.';
  end if;
end
$rollback_guard$;

drop trigger if exists canonicalize_social_assignment_role
  on public.social_case_assignments;
drop function if exists public.canonicalize_social_assignment_role();

drop index if exists public.social_case_assignments_one_active_role;

drop function if exists public.open_care_case_from_intake(uuid,text,text,uuid);
drop function if exists public.complete_social_intake(uuid,text,text);
drop function if exists public.create_social_intake(uuid,uuid,uuid,uuid,text,text,text[],uuid);

drop trigger if exists social_intake_number_immutable on public.social_intakes;
drop trigger if exists social_intake_number_assign on public.social_intakes;
drop function if exists public.prevent_social_intake_number_change();
drop function if exists public.assign_social_intake_number();

drop table if exists public.social_intakes;
drop table if exists public.social_intake_number_counters;

notify pgrst, 'reload schema';
commit;
