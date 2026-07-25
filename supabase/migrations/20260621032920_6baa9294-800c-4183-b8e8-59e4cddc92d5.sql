GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_findings TO authenticated;
GRANT ALL ON public.agent_findings TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_findings'
      AND policyname = 'users insert own agent_findings'
  ) THEN
    CREATE POLICY "users insert own agent_findings"
      ON public.agent_findings
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_findings'
      AND policyname = 'users update own agent_findings'
  ) THEN
    CREATE POLICY "users update own agent_findings"
      ON public.agent_findings
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
      WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_findings'
      AND policyname = 'users delete own agent_findings'
  ) THEN
    CREATE POLICY "users delete own agent_findings"
      ON public.agent_findings
      FOR DELETE
      TO authenticated
      USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_scores TO authenticated;
GRANT ALL ON public.case_scores TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'case_scores'
      AND policyname = 'users insert own case_scores'
  ) THEN
    CREATE POLICY "users insert own case_scores"
      ON public.case_scores
      FOR INSERT
      TO authenticated
      WITH CHECK (user_id = auth.uid());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'case_scores'
      AND policyname = 'users update own case_scores'
  ) THEN
    CREATE POLICY "users update own case_scores"
      ON public.case_scores
      FOR UPDATE
      TO authenticated
      USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
      WITH CHECK (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'case_scores'
      AND policyname = 'users delete own case_scores'
  ) THEN
    CREATE POLICY "users delete own case_scores"
      ON public.case_scores
      FOR DELETE
      TO authenticated
      USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;