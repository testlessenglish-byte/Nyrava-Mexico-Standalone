-- The scoring step upserts into public.case_scores with ON CONFLICT (case_id).
-- Postgres requires a SELECT policy on the target table for INSERT ... ON
-- CONFLICT DO UPDATE (the conflicting row must be visible), and PostgREST also
-- returns the affected row. case_scores had INSERT/UPDATE/DELETE policies but
-- no SELECT policy, so every upsert from the authenticated (UI-triggered)
-- pipeline path failed with "new row violates row-level security policy".
-- Mirrors the existing case_findings SELECT policy exactly.
CREATE POLICY "users select own case_scores"
  ON public.case_scores
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_scores TO authenticated;
GRANT ALL ON public.case_scores TO service_role;