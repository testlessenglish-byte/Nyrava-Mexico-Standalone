-- Phase 20: Mexican Legal Knowledge Ingestion Pipeline — supporting tables.
-- legal_authorities, legal_citations, legal_source_connectors already exist
-- (from Mexico's own Phase 2 Hardening migration). This adds what the new
-- ingestion framework (src/lib/legal-connectors/) needs on top of that.

-- Version history: prior text of a legal_authorities row, archived whenever
-- an ingestion run detects the text actually changed.
CREATE TABLE IF NOT EXISTS public.legal_authority_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid NOT NULL REFERENCES public.legal_authorities(id) ON DELETE CASCADE,
  body text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legal_authority_versions_authority_idx
  ON public.legal_authority_versions (authority_id, archived_at DESC);

GRANT SELECT ON public.legal_authority_versions TO authenticated, anon;
GRANT ALL ON public.legal_authority_versions TO service_role;
ALTER TABLE public.legal_authority_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "legal_authority_versions public read" ON public.legal_authority_versions;
CREATE POLICY "legal_authority_versions public read" ON public.legal_authority_versions FOR SELECT USING (true);

-- Run ledger for the ingestion worker — same observability pattern as
-- pipeline_engine_runs for the case-analysis engine.
CREATE TABLE IF NOT EXISTS public.legal_ingest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connector_code text NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  status text NOT NULL CHECK (status IN ('completed','failed','completed_with_errors')),
  documents_fetched integer NOT NULL DEFAULT 0,
  documents_stored integer NOT NULL DEFAULT 0,
  documents_versioned integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS legal_ingest_runs_connector_idx
  ON public.legal_ingest_runs (connector_code, started_at DESC);

GRANT SELECT ON public.legal_ingest_runs TO authenticated;
GRANT ALL ON public.legal_ingest_runs TO service_role;
ALTER TABLE public.legal_ingest_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "legal_ingest_runs admin read" ON public.legal_ingest_runs;
CREATE POLICY "legal_ingest_runs admin read" ON public.legal_ingest_runs FOR SELECT TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

-- Worker secret for the legal-ingest-worker route (same pattern as the
-- existing pipeline_worker secret). Seeded now; cron scheduling itself is
-- commented-out until pg_cron is enabled and a real domain exists to point
-- at — see the comment block at the bottom of legal-ingest-worker.ts.
INSERT INTO public.worker_secrets (name, secret)
VALUES ('legal_ingest_worker', encode(gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;
