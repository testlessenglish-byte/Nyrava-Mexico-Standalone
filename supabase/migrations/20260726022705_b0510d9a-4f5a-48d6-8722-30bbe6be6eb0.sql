CREATE TABLE public.pipeline_trace (
  id BIGSERIAL PRIMARY KEY,
  case_id UUID NOT NULL,
  user_id UUID,
  correlation_id TEXT,
  phase TEXT NOT NULL,
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'info',
  level TEXT NOT NULL DEFAULT 'info',
  provider TEXT,
  model TEXT,
  attempt INTEGER,
  duration_ms INTEGER,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pipeline_trace TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.pipeline_trace_id_seq TO authenticated;
GRANT ALL ON public.pipeline_trace TO service_role;
GRANT ALL ON SEQUENCE public.pipeline_trace_id_seq TO service_role;

ALTER TABLE public.pipeline_trace ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read trace for their own cases"
ON public.pipeline_trace
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id = pipeline_trace.case_id
      AND c.user_id = auth.uid()
  )
);

CREATE POLICY "Users insert trace for their own cases"
ON public.pipeline_trace
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.cases c
    WHERE c.id = pipeline_trace.case_id
      AND c.user_id = auth.uid()
  )
);

CREATE INDEX idx_pipeline_trace_case_id ON public.pipeline_trace (case_id, id DESC);
CREATE INDEX idx_pipeline_trace_created_at ON public.pipeline_trace (created_at DESC);
CREATE INDEX idx_pipeline_trace_corr ON public.pipeline_trace (correlation_id);