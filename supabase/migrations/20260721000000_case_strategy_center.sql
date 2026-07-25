-- Litigation Strategy Center
-- One synthesized row per case, built from data already produced (and
-- already evidence-gated) by the theory / opportunity / witness /
-- perspective / strategy engines. This engine does not re-touch the
-- corpus and does not re-run evidence-gate verification — see
-- runLitigationStrategyCenterEngine in litigation.server.ts.

CREATE TABLE public.case_strategy_center (
  case_id uuid PRIMARY KEY REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,

  -- "What Wins This Case?"
  primary_trial_theme jsonb DEFAULT '{}'::jsonb,     -- { theme, why, supporting_evidence[], presentation_guidance, persuasion_likelihood }

  -- "What Could Lose This Case?"
  biggest_weakness jsonb DEFAULT '{}'::jsonb,        -- { weakness, why_it_matters }
  biggest_trial_risk jsonb DEFAULT '{}'::jsonb,       -- { risk, explanation }

  -- Settlement leverage
  settlement_leverage jsonb DEFAULT '[]'::jsonb,     -- [{ item, why_it_increases_pressure }]

  -- Most dangerous witness — grounded against case_witnesses; dropped
  -- entirely (null) rather than trusted if the LLM names someone not
  -- actually in the witness table.
  most_dangerous_witness jsonb DEFAULT '{}'::jsonb,  -- { witness_id, name, reasons[], recommended_approach[] }

  -- Biggest evidentiary gap
  biggest_evidentiary_gap jsonb DEFAULT '{}'::jsonb, -- { item, importance, impact, how_to_obtain[], potential_benefit }

  -- Anticipated defense + counter
  expected_defense jsonb DEFAULT '{}'::jsonb,        -- { primary_defense, supporting_arguments[], weaknesses[] }
  recommended_counter_strategy text,

  -- "What Should Counsel Do This Week?"
  weekly_priorities jsonb DEFAULT '[]'::jsonb,       -- [{ priority, action, impact_stars, reason }]

  -- Computed in code (not asked from the model) so it can never drift out
  -- of sync with the narrative fields above.
  winning_the_case_dashboard jsonb DEFAULT '[]'::jsonb, -- [{ question, assessment }]
  lead_counsel_assessment text,                          -- always ends with the "not legal advice" disclaimer

  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_strategy_center TO authenticated;
GRANT ALL ON public.case_strategy_center TO service_role;

ALTER TABLE public.case_strategy_center ENABLE ROW LEVEL SECURITY;

CREATE POLICY "strategy center all" ON public.case_strategy_center FOR ALL TO authenticated
  USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'))
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER tg_case_strategy_center_updated_at
  BEFORE UPDATE ON public.case_strategy_center
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS strategy_center_at timestamptz;
