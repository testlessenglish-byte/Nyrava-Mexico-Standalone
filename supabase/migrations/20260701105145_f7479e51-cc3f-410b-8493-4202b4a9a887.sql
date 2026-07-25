
-- Step 7: firm tenancy foundation
CREATE TABLE IF NOT EXISTS public.firms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (domain)
);
GRANT SELECT ON public.firms TO authenticated;
GRANT ALL ON public.firms TO service_role;
ALTER TABLE public.firms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS firms_read ON public.firms;
CREATE POLICY firms_read ON public.firms FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS firms_admin_write ON public.firms;
CREATE POLICY firms_admin_write ON public.firms FOR ALL TO authenticated
USING (public.is_admin_tier(auth.uid()))
WITH CHECK (public.is_admin_tier(auth.uid()));

DROP TRIGGER IF EXISTS firms_set_updated_at ON public.firms;
CREATE TRIGGER firms_set_updated_at BEFORE UPDATE ON public.firms
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS firm_id UUID REFERENCES public.firms(id) ON DELETE SET NULL;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS firm_id UUID REFERENCES public.firms(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS cases_firm_id_idx ON public.cases (firm_id) WHERE firm_id IS NOT NULL;

-- Step 6: background queue columns
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS worker_lease_until TIMESTAMPTZ;
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS next_stage TEXT;
CREATE INDEX IF NOT EXISTS cases_queue_idx ON public.cases (queued_at)
  WHERE queued_at IS NOT NULL AND status <> 'complete';
