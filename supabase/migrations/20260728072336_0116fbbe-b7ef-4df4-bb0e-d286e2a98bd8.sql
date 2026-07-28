-- PRD Phase 3 — Universal Practice Area Architecture: core Tasks + Calendar
-- capabilities and the attorney-facing lifecycle status.
CREATE TABLE IF NOT EXISTS public.case_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  assignee_hint text,
  due_date date,
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo','in_progress','blocked','done','cancelled')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high')),
  template_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_tasks TO authenticated;
GRANT ALL ON public.case_tasks TO service_role;
ALTER TABLE public.case_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks all" ON public.case_tasks
  FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS case_tasks_case_id_idx ON public.case_tasks(case_id);
CREATE INDEX IF NOT EXISTS case_tasks_due_idx ON public.case_tasks(user_id, due_date);
CREATE UNIQUE INDEX IF NOT EXISTS case_tasks_template_unique
  ON public.case_tasks(case_id, template_key) WHERE template_key IS NOT NULL;
CREATE TRIGGER case_tasks_set_updated_at
  BEFORE UPDATE ON public.case_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  event_type text NOT NULL DEFAULT 'other',
  scheduled_at timestamptz NOT NULL,
  location text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.case_events TO authenticated;
GRANT ALL ON public.case_events TO service_role;
ALTER TABLE public.case_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events all" ON public.case_events
  FOR ALL TO authenticated
  USING ((user_id = auth.uid()) OR private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (user_id = auth.uid());
CREATE INDEX IF NOT EXISTS case_events_case_id_idx ON public.case_events(case_id);
CREATE INDEX IF NOT EXISTS case_events_sched_idx ON public.case_events(user_id, scheduled_at);
CREATE TRIGGER case_events_set_updated_at
  BEFORE UPDATE ON public.case_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Attorney-facing lifecycle status. Allowed values are validated in the
-- application layer against the practice-area registry (mexico-modules.ts);
-- the pipeline never writes this column.
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS lifecycle_status text DEFAULT 'intake';