GRANT SELECT, INSERT ON public.pipeline_events TO authenticated;
GRANT ALL ON public.pipeline_events TO service_role;

DROP POLICY IF EXISTS "pipeline_events insert by case owner" ON public.pipeline_events;
CREATE POLICY "pipeline_events insert by case owner"
ON public.pipeline_events
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.cases c
    WHERE c.id = pipeline_events.case_id
      AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "pipeline_events read by case owner" ON public.pipeline_events;
CREATE POLICY "pipeline_events read by case owner"
ON public.pipeline_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.cases c
    WHERE c.id = pipeline_events.case_id
      AND (c.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  )
);