
-- Canonical Execution Refactor — one-time backfill.
-- For each cases.*_at timestamp column that indicates an engine finished
-- successfully in the pre-canonical era, insert a synthetic completed
-- pipeline_engine_runs row IF none exists for that (case_id, engine).
-- Idempotent: safe to re-run.

DO $$
DECLARE
  mapping RECORD;
BEGIN
  FOR mapping IN
    SELECT * FROM (VALUES
      ('extraction',                'extracted_at'),
      ('analyzers',                 'analysis_at'),
      ('agents',                    'agents_at'),
      ('contradictions',            'contradiction_at'),
      ('witness_intelligence',      'witnesses_at'),
      ('evidence_intelligence',     'evidence_intel_at'),
      ('discovery_gaps',            'discovery_at'),
      ('perspectives',              'perspectives_at'),
      ('theory',                    'theories_at'),
      ('opportunity',               'opportunities_at'),
      ('trial_prep',                'trial_prep_at'),
      ('strategy',                  'strategy_at'),
      ('work_product',              'work_product_at'),
      ('hallucination',             'hallucination_at'),
      ('scoring',                   'scored_at'),
      ('report_generator',          'report_at')
    ) AS t(engine, col)
  LOOP
    EXECUTE format($f$
      INSERT INTO public.pipeline_engine_runs
        (case_id, user_id, engine, status, started_at, ended_at, meta)
      SELECT c.id, c.user_id, %L, 'completed', c.%I, c.%I,
             jsonb_build_object('source', 'canonical_backfill_2026_07_02')
        FROM public.cases c
       WHERE c.%I IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM public.pipeline_engine_runs r
            WHERE r.case_id = c.id AND r.engine = %L
         )
    $f$, mapping.engine, mapping.col, mapping.col, mapping.col, mapping.engine);
  END LOOP;
END $$;
