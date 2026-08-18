-- Nyrava Verified Legal Intelligence: one analysis standard.
--
-- The application keeps the legacy value `strict` as the storage token for
-- compatibility with existing code and historical rows, but new/updated cases
-- can no longer fork into materially different strict/exploratory pipelines.
-- Case purpose remains orthogonal (`ongoing` vs `concluded_audit`).

create or replace function public.nyrava_enforce_verified_analysis_mode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.analysis_mode := 'strict';
  return new;
end;
$$;

drop trigger if exists trg_nyrava_verified_analysis_mode on public.cases;
create trigger trg_nyrava_verified_analysis_mode
before insert or update of analysis_mode on public.cases
for each row
execute function public.nyrava_enforce_verified_analysis_mode();

comment on function public.nyrava_enforce_verified_analysis_mode() is
  'Canonicalizes the retired strict/exploratory user choice to the single Nyrava Verified Legal Intelligence storage mode. Case analysis purpose remains controlled by case_analysis_mode.';
