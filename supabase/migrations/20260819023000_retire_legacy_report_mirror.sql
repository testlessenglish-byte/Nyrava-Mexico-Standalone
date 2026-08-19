-- Nyrava Mexico canonical-state cleanup.
--
-- Live-schema audit confirmed that public.canonical_analysis had TWO writers:
--   1) the current pipeline/application canonical write path; and
--   2) legacy trigger reports.mirror_reports_to_canonical, which ran after
--      every INSERT/UPDATE on public.reports and silently upserted the report
--      payload back into canonical_analysis.
--
-- That second path makes write ordering observable: an older/stale reports
-- update can overwrite a newer canonical snapshot. Retire only that mirror.
-- public.reports itself remains in use by the report renderer/export surfaces
-- and is intentionally NOT dropped here.

begin;

drop trigger if exists mirror_reports_to_canonical on public.reports;
drop function if exists public.tg_mirror_reports_to_canonical();

comment on table public.canonical_analysis is
  'Canonical analysis state. Legacy reports-to-canonical mirror retired 2026-08-19; canonical state must be written explicitly by the current pipeline/application path.';

comment on table public.reports is
  'Rendered/report artifact store. Must not implicitly overwrite public.canonical_analysis.';

commit;
