-- Nyrava México — one verified analysis policy.
--
-- IMPORTANT COMPATIBILITY DETAIL:
-- Some older application modules still deserialize cases.analysis_mode as the
-- historical strict|balanced|exploratory union. The evidence gate in
-- particular historically applied DIFFERENT acceptance rules to those tokens.
-- Therefore simply removing the UI selector/DB CHECK is not sufficient: an
-- old `strict` row can still silently make the evidence gate stricter than a
-- `balanced` row.
--
-- Until the compatibility column/type is physically removed from every caller,
-- use `balanced` ONLY as an internal storage token for the single verified
-- policy: verified citations are required, evidence-backed inference survives,
-- unsupported AI theory does not. It is no longer a user-selectable analysis
-- depth. `case_analysis_mode` remains the real procedural-posture control.

begin;

alter table public.cases
  drop constraint if exists cases_analysis_mode_check;

-- Normalize every historical row so no existing case can keep a hidden
-- strict/exploratory evidence-policy fork.
update public.cases
set analysis_mode = 'balanced'
where analysis_mode is distinct from 'balanced';

alter table public.cases
  alter column analysis_mode set default 'balanced';

create or replace function public.nyrava_enforce_verified_analysis_mode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- `balanced` is now ONLY the compatibility token for the one Nyrava
  -- Verified evidence policy. It must never represent a selectable mode.
  new.analysis_mode := 'balanced';
  return new;
end;
$$;

drop trigger if exists trg_nyrava_verified_analysis_mode on public.cases;
create trigger trg_nyrava_verified_analysis_mode
before insert or update of analysis_mode on public.cases
for each row
execute function public.nyrava_enforce_verified_analysis_mode();

comment on column public.cases.analysis_mode is
  'LEGACY compatibility token. Always normalized to balanced, which represents the single Nyrava Verified evidence policy. Never branch product behavior or UI on this field; use case_analysis_mode only for procedural posture.';

comment on function public.nyrava_enforce_verified_analysis_mode() is
  'Prevents historical strict/balanced/exploratory values from reintroducing different evidence-gate behavior. balanced is a compatibility token only, not a user mode.';

-- Feature-routing rows inherited the same retired vocabulary. Normalize those
-- values as well so no feature-routing consumer can resurrect a hidden mode.
update public.user_intelligence_features
set mode = 'balanced'
where mode in ('strict', 'balanced', 'exploratory')
  and mode is distinct from 'balanced';

alter table public.user_intelligence_features
  alter column mode set default 'balanced';

comment on column public.user_intelligence_features.mode is
  'Legacy compatibility metadata. balanced is the single verified-policy token and must not control case analysis depth or engine selection.';

commit;
