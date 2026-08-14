-- ============================================================================
-- Continuous Legal Intelligence Phase C — validation rules as DATA.
--
-- Phase B's self-audit (auditFindingAgainstPatterns, patterns.server.ts)
-- escalates a live finding review using a hardcoded TypeScript map
-- (tier -> recommended_action). This table lets that mapping be overridden
-- per (user_id, matter_type, jurisdiction_country, error_type) bucket by a
-- controlled, human-approved deployment (see intelligence_improvement_
-- proposals / intelligence_versions) — never by an LLM editing code.
--
-- When no active rule exists for a bucket, self-audit keeps using today's
-- global default unchanged. This table starts empty in every environment,
-- so shipping it changes no existing behavior until a proposal is actually
-- deployed through the full propose -> replay -> regression -> approve ->
-- deploy pipeline (proposals.server.ts).
--
-- Rows are never edited in place: superseding a rule flips is_active off
-- and links superseded_by_rule_id forward, so the complete rule history is
-- always reconstructable ("what did NYRAVA believe, why, what replaced
-- it" — never destroyed).
-- ============================================================================

CREATE TYPE public.intelligence_recommended_action AS ENUM (
  'require_additional_evidence',
  'require_second_source',
  'require_authority_verification',
  'require_procedural_posture_verification',
  'lower_confidence',
  'send_to_critic',
  'require_human_review'
);

CREATE TABLE IF NOT EXISTS public.intelligence_validation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  matter_type text,
  jurisdiction_country text NOT NULL DEFAULT 'MX',
  error_type public.intelligence_error_type NOT NULL,

  -- Only candidate/strong/significant are audit-eligible tiers (see
  -- patterns.server.ts's AUDIT_ELIGIBLE_TIERS) — a rule for
  -- insufficient_sample/emerging could never fire, so it's rejected here.
  escalate_at_tier public.intelligence_pattern_tier NOT NULL
    CHECK (escalate_at_tier IN ('candidate', 'strong', 'significant')),
  recommended_action public.intelligence_recommended_action NOT NULL,

  is_active boolean NOT NULL DEFAULT true,
  version integer NOT NULL,
  superseded_by_rule_id uuid REFERENCES public.intelligence_validation_rules(id),
  source_proposal_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.intelligence_validation_rules TO authenticated;
GRANT ALL ON public.intelligence_validation_rules TO service_role;
ALTER TABLE public.intelligence_validation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS intelligence_validation_rules_owner_select ON public.intelligence_validation_rules;
CREATE POLICY intelligence_validation_rules_owner_select ON public.intelligence_validation_rules
  FOR SELECT USING (user_id = auth.uid());

-- Only one active rule per bucket at a time.
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_validation_rules_active_bucket_idx
  ON public.intelligence_validation_rules(user_id, matter_type, jurisdiction_country, error_type)
  WHERE is_active;

COMMENT ON TABLE public.intelligence_validation_rules IS
  'Data-encoded overrides of the self-audit tier->action escalation policy. Never edited in place (superseded_by_rule_id links history forward). Only ever written by proposals.server.ts''s deployProposal/rollbackVersion, which only run on an already-approved proposal.';
