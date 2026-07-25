
-- 1. matter_knowledge: language column
ALTER TABLE public.matter_knowledge
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'es';

-- 2. matter_documents: extracted text + language + page_count
ALTER TABLE public.matter_documents
  ADD COLUMN IF NOT EXISTS text_content TEXT,
  ADD COLUMN IF NOT EXISTS language TEXT,
  ADD COLUMN IF NOT EXISTS page_count INTEGER;

-- 3. document_processing_jobs: progress + contributor update policy
ALTER TABLE public.document_processing_jobs
  ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0;

DROP POLICY IF EXISTS "docjobs_contrib_write" ON public.document_processing_jobs;
CREATE POLICY "docjobs_contrib_write" ON public.document_processing_jobs
  FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

DROP POLICY IF EXISTS "docjobs_contrib_update" ON public.document_processing_jobs;
CREATE POLICY "docjobs_contrib_update" ON public.document_processing_jobs
  FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id))
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

-- 4. intelligence_runs: contributor update policy (for status transitions)
DROP POLICY IF EXISTS "intel_runs_update" ON public.intelligence_runs;
CREATE POLICY "intel_runs_update" ON public.intelligence_runs
  FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id))
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

-- 5. knowledge_relationships (knowledge graph edges)
CREATE TABLE IF NOT EXISTS public.knowledge_relationships (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  matter_id UUID NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.matter_knowledge(id) ON DELETE CASCADE,
  object_id  UUID NOT NULL REFERENCES public.matter_knowledge(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  weight NUMERIC(5,4),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_run_id UUID REFERENCES public.intelligence_runs(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_relationships_distinct CHECK (subject_id <> object_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_relationships TO authenticated;
GRANT ALL ON public.knowledge_relationships TO service_role;

ALTER TABLE public.knowledge_relationships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "kr_select" ON public.knowledge_relationships
  FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id));

CREATE POLICY "kr_contrib_write" ON public.knowledge_relationships
  FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "kr_contrib_update" ON public.knowledge_relationships
  FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id))
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));

CREATE POLICY "kr_admin_delete" ON public.knowledge_relationships
  FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

CREATE INDEX IF NOT EXISTS idx_kr_matter ON public.knowledge_relationships(matter_id);
CREATE INDEX IF NOT EXISTS idx_kr_subject ON public.knowledge_relationships(subject_id);
CREATE INDEX IF NOT EXISTS idx_kr_object ON public.knowledge_relationships(object_id);
CREATE INDEX IF NOT EXISTS idx_kr_relation ON public.knowledge_relationships(matter_id, relation);

CREATE TRIGGER trg_kr_updated
  BEFORE UPDATE ON public.knowledge_relationships
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 6. Useful index for knowledge lookups by kind
CREATE INDEX IF NOT EXISTS idx_mk_matter_kind ON public.matter_knowledge(matter_id, kind);
