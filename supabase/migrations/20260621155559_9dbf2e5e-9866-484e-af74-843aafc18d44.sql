
ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS citations jsonb,
  ADD COLUMN IF NOT EXISTS evidence_index jsonb,
  ADD COLUMN IF NOT EXISTS contradictions_struct jsonb,
  ADD COLUMN IF NOT EXISTS missing_evidence_struct jsonb,
  ADD COLUMN IF NOT EXISTS strategy_recommendations jsonb,
  ADD COLUMN IF NOT EXISTS cross_examination jsonb,
  ADD COLUMN IF NOT EXISTS constitutional_issues_struct jsonb,
  ADD COLUMN IF NOT EXISTS motion_opportunities jsonb,
  ADD COLUMN IF NOT EXISTS next_actions jsonb,
  ADD COLUMN IF NOT EXISTS case_strength_score integer,
  ADD COLUMN IF NOT EXISTS risk_score integer,
  ADD COLUMN IF NOT EXISTS intelligence_version text;
