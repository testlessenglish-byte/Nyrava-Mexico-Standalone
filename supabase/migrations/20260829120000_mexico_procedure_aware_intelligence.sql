-- ============================================================================
-- Migration: Mexico Procedure-Aware Intelligence & Schema Hardening
--
-- 1. Relax case_theories UNIQUE (case_id, theory_type) constraint to allow
--    multiple theories per Mexican procedural role (e.g., quejoso primary
--    vs alternative constitutional violation theories).
-- 2. Add execution_id to case_theories and case_opportunities for full
--    per-run execution isolation.
-- 3. Add canonical_fingerprint to case_findings for deterministic cross-batch
--    finding deduplication.
-- 4. Add composite performance indexes for execution-scoped queries.
-- 5. Safe backfill for historical cases missing procedural_vehicle.
-- ============================================================================

-- 1. case_theories hardening
ALTER TABLE public.case_theories
  DROP CONSTRAINT IF EXISTS case_theories_case_id_theory_type_key;

ALTER TABLE public.case_theories
  ADD COLUMN IF NOT EXISTS theory_name text,
  ADD COLUMN IF NOT EXISTS execution_id uuid;

CREATE INDEX IF NOT EXISTS idx_case_theories_case_exec
  ON public.case_theories(case_id, execution_id);

CREATE INDEX IF NOT EXISTS idx_case_theories_case_type
  ON public.case_theories(case_id, theory_type);

-- 2. case_opportunities hardening
ALTER TABLE public.case_opportunities
  ADD COLUMN IF NOT EXISTS execution_id uuid,
  ADD COLUMN IF NOT EXISTS canonical_role text;

CREATE INDEX IF NOT EXISTS idx_case_opps_case_exec
  ON public.case_opportunities(case_id, execution_id);

CREATE INDEX IF NOT EXISTS idx_case_opps_side
  ON public.case_opportunities(case_id, side);

-- 3. case_findings deterministic deduplication fingerprint
ALTER TABLE public.case_findings
  ADD COLUMN IF NOT EXISTS canonical_fingerprint text;

CREATE INDEX IF NOT EXISTS idx_case_findings_canonical_fingerprint
  ON public.case_findings(case_id, canonical_fingerprint);

-- 4. pipeline_engine_runs execution composite index
CREATE INDEX IF NOT EXISTS idx_pipeline_engine_runs_case_exec_engine
  ON public.pipeline_engine_runs(case_id, execution_id, engine);

-- 5. cases multidimensional classification indexes
CREATE INDEX IF NOT EXISTS idx_cases_procedural_vehicle
  ON public.cases(procedural_vehicle);

CREATE INDEX IF NOT EXISTS idx_cases_underlying_materia
  ON public.cases(underlying_materia);

-- 6. Safe backward-compatible historical backfill
UPDATE public.cases
SET procedural_vehicle = 'amparo_directo_revision'
WHERE case_type = 'amparo'
  AND procedural_vehicle IS NULL
  AND (name ILIKE '%directo en revisi%' OR name ILIKE '%adr%' OR description ILIKE '%amparo directo en revisión%');

UPDATE public.cases
SET procedural_vehicle = 'amparo_indirecto'
WHERE case_type = 'amparo'
  AND procedural_vehicle IS NULL
  AND (name ILIKE '%indirecto%' OR description ILIKE '%amparo indirecto%');

UPDATE public.cases
SET procedural_vehicle = 'amparo_directo'
WHERE case_type = 'amparo'
  AND procedural_vehicle IS NULL
  AND (name ILIKE '%directo%' OR description ILIKE '%amparo directo%');

UPDATE public.cases
SET procedural_vehicle = 'inmobiliario_litigio'
WHERE case_type = 'inmobiliario'
  AND procedural_vehicle IS NULL
  AND (name ILIKE '%litigio%' OR name ILIKE '%juicio%' OR name ILIKE '%reivindicatorio%' OR name ILIKE '%usucapion%');

UPDATE public.cases
SET procedural_vehicle = 'inmobiliario_transaccional'
WHERE case_type = 'inmobiliario'
  AND procedural_vehicle IS NULL;
