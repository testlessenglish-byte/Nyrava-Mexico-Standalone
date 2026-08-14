-- ============================================================================
-- Continuous Legal Intelligence Phase C — improvement proposals.
--
-- "The AI may propose — never self-authorize" (directive §11/§13). A
-- proposal targets exactly one intelligence_validation_rules bucket and
-- proposes exactly one change: escalate at a given pattern tier with a
-- given action. Never a code diff, never a prompt change — pure data,
-- matching intelligence_validation_rules' own discipline.
--
-- Lifecycle (proposals.server.ts), each transition its own function so no
-- single call can skip a gate:
--   proposed -> testing            (runHistoricalReplay)
--   testing  -> passed | failed    (runRegressionCheck)
--   passed   -> approved           (approveProposal — a real human action)
--   approved -> deployed           (deployProposal)
--   deployed -> rolled_back        (rollbackVersion, via intelligence_versions)
-- ============================================================================

CREATE TYPE public.intelligence_proposal_status AS ENUM (
  'proposed',
  'testing',
  'passed',
  'failed',
  'approved',
  'deployed',
  'rolled_back'
);

CREATE TABLE IF NOT EXISTS public.intelligence_improvement_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  matter_type text,
  jurisdiction_country text NOT NULL DEFAULT 'MX',
  error_type public.intelligence_error_type NOT NULL,
  supporting_pattern_id uuid NOT NULL REFERENCES public.intelligence_patterns(id) ON DELETE CASCADE,

  -- Deterministically generated from the pattern's own real counts
  -- (mirrors patterns.server.ts's describePattern) — never an LLM
  -- narrative that could drift from what the data actually shows.
  problem text NOT NULL,
  observed_failure text NOT NULL,

  proposed_escalate_at_tier public.intelligence_pattern_tier NOT NULL
    CHECK (proposed_escalate_at_tier IN ('candidate', 'strong', 'significant')),
  proposed_recommended_action public.intelligence_recommended_action NOT NULL,

  status public.intelligence_proposal_status NOT NULL DEFAULT 'proposed',

  -- { findings_evaluated, findings_would_change_action, insufficient_data, evaluated_at }
  historical_replay jsonb,
  -- { invariant_holds, reason, checked_at }
  regression_check jsonb,

  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  deployed_version integer,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.intelligence_improvement_proposals TO authenticated;
GRANT ALL ON public.intelligence_improvement_proposals TO service_role;
ALTER TABLE public.intelligence_improvement_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intelligence_improvement_proposals_owner_select ON public.intelligence_improvement_proposals;
CREATE POLICY intelligence_improvement_proposals_owner_select ON public.intelligence_improvement_proposals
  FOR SELECT USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS intelligence_improvement_proposals_bucket_idx
  ON public.intelligence_improvement_proposals(user_id, matter_type, jurisdiction_country, error_type);

COMMENT ON TABLE public.intelligence_improvement_proposals IS
  'One row per proposed change to the self-audit escalation policy for one bucket. Every transition (replay/regression/approve/deploy) is a separate function in proposals.server.ts — no path can skip a gate. historical_replay/regression_check always carry real integer counts, never a fabricated percentage.';
