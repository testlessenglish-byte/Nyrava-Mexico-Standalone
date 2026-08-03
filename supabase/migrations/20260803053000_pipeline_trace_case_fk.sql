-- pipeline_trace was created (20260726022705) with a bare `case_id UUID NOT
-- NULL` and no foreign key at all — every other case-scoped diagnostic
-- table (pipeline_events, pipeline_engine_runs, verification_items,
-- finding_version_snapshots, cross_agent_audit) has case_id REFERENCES
-- public.cases(id) ON DELETE CASCADE, but this one was missed. Practical
-- effect: pipeline_trace rows never get cleaned up under ANY circumstance —
-- not on a full case Rerun (which only clears an explicit table list, since
-- there's no CASCADE to lean on) and not even on a full case Delete (which
-- relies entirely on CASCADE and has no explicit fallback for this table).
-- Rows just accumulate forever, including orphaned rows whose case_id
-- points at a case that no longer exists post-delete.
--
-- Any row already orphaned (case_id with no matching case) is deleted
-- first, since you cannot add a FK that some existing rows would violate.
DELETE FROM public.pipeline_trace pt
WHERE NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = pt.case_id);

ALTER TABLE public.pipeline_trace
  ADD CONSTRAINT pipeline_trace_case_id_fkey
  FOREIGN KEY (case_id) REFERENCES public.cases(id) ON DELETE CASCADE;
