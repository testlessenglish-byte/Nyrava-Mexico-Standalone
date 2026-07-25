-- Nyrava Legal Knowledge Network (NLKN) expansion.
--
-- Extends the EXISTING legal_authorities/legal_citations/legal_source_connectors
-- system (built earlier this session) with article-level granularity,
-- richer verification states, and the additional entity types requested.
-- Does NOT replace or duplicate anything already in place.

-- ============================================================
-- 1. Verification status on legal_authorities (was boolean-ish/absent;
--    now a proper 5-state lifecycle per spec).
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.legal_verification_status AS ENUM
    ('verified', 'pending', 'deprecated', 'superseded', 'failed_verification');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.legal_authorities
  ADD COLUMN IF NOT EXISTS verification_status public.legal_verification_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS repealed_at date,
  ADD COLUMN IF NOT EXISTS superseded_by_id uuid REFERENCES public.legal_authorities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS connector_code text;

COMMENT ON COLUMN public.legal_authorities.verification_status IS
  'AI may only cite verified authorities by default (see legal-authority-verify.server.ts). pending = ingested but not yet human/process-verified; failed_verification = a verification attempt found a discrepancy against the official source.';

-- ============================================================
-- 2. legal_articles — article-level breakdown of a legal_authorities row
--    (a law/code), so citations resolve to a specific article, not just
--    "the law generally".
-- ============================================================
CREATE TABLE IF NOT EXISTS public.legal_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid NOT NULL REFERENCES public.legal_authorities(id) ON DELETE CASCADE,
  article_number text NOT NULL,   -- '123', '3 Bis', '19'
  heading text,
  body text NOT NULL,
  effective_at date,
  repealed_at date,
  verification_status public.legal_verification_status NOT NULL DEFAULT 'pending',
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (authority_id, article_number)
);
GRANT SELECT ON public.legal_articles TO authenticated, anon;
GRANT ALL ON public.legal_articles TO service_role;
ALTER TABLE public.legal_articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_articles_public_read ON public.legal_articles;
CREATE POLICY legal_articles_public_read ON public.legal_articles FOR SELECT USING (true);
DROP TRIGGER IF EXISTS trg_legal_articles_updated ON public.legal_articles;
CREATE TRIGGER trg_legal_articles_updated BEFORE UPDATE ON public.legal_articles
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS legal_articles_authority_idx ON public.legal_articles(authority_id);

-- ============================================================
-- 3. legal_amendments — history of changes to a specific article. Text is
--    NEVER overwritten (per spec) — this is the append-only amendment log;
--    legal_authority_versions (existing table) covers whole-document
--    snapshots, this covers article-level diffs specifically.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.legal_amendments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id uuid NOT NULL REFERENCES public.legal_articles(id) ON DELETE CASCADE,
  previous_body text,
  new_body text NOT NULL,
  amendment_type text NOT NULL DEFAULT 'reform' CHECK (amendment_type IN ('reform', 'addition', 'repeal', 'correction')),
  decree_reference text,   -- e.g. DOF publication reference enacting the change
  effective_at date,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.legal_amendments TO authenticated, anon;
GRANT ALL ON public.legal_amendments TO service_role;
ALTER TABLE public.legal_amendments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_amendments_public_read ON public.legal_amendments;
CREATE POLICY legal_amendments_public_read ON public.legal_amendments FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS legal_amendments_article_idx ON public.legal_amendments(article_id, effective_at DESC);

-- ============================================================
-- 4. legal_precedents — court decisions with binding/persuasive weight,
--    distinct from legal_jurisprudencia (the SCJN-specific formal category
--    of mandatory jurisprudencia below).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.legal_precedents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_id uuid REFERENCES public.legal_authorities(id) ON DELETE SET NULL,
  court text NOT NULL,               -- 'SCJN 1a Sala','Tribunal Colegiado 3o Circuito', etc.
  case_number text,
  decision_date date,
  jurisdiction text,
  binding boolean NOT NULL DEFAULT false,
  summary text,
  full_text text,
  source_url text,
  verification_status public.legal_verification_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.legal_precedents TO authenticated, anon;
GRANT ALL ON public.legal_precedents TO service_role;
ALTER TABLE public.legal_precedents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_precedents_public_read ON public.legal_precedents;
CREATE POLICY legal_precedents_public_read ON public.legal_precedents FOR SELECT USING (true);
DROP TRIGGER IF EXISTS trg_legal_precedents_updated ON public.legal_precedents;
CREATE TRIGGER trg_legal_precedents_updated BEFORE UPDATE ON public.legal_precedents
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS legal_precedents_case_number_idx ON public.legal_precedents(case_number);

-- ============================================================
-- 5. legal_jurisprudencia — SCJN's formal binding-jurisprudence category
--    (jurisprudencia by reiteration, contradicción de tesis, sustitución).
--    Distinct from legal_theses (isolated theses, non-binding until they
--    become jurisprudencia).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.legal_jurisprudencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_number text UNIQUE,   -- SCJN's own "número de registro"
  title text NOT NULL,
  body text NOT NULL,
  formation_method text CHECK (formation_method IN ('reiteracion', 'contradiccion_de_tesis', 'sustitucion')),
  issuing_body text,             -- 'Pleno','1a Sala','2a Sala','Plenos Regionales'
  epoca text,                    -- 'Décima Época', etc.
  published_at date,
  binding boolean NOT NULL DEFAULT true,
  source_url text,
  verification_status public.legal_verification_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.legal_jurisprudencia TO authenticated, anon;
GRANT ALL ON public.legal_jurisprudencia TO service_role;
ALTER TABLE public.legal_jurisprudencia ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_jurisprudencia_public_read ON public.legal_jurisprudencia;
CREATE POLICY legal_jurisprudencia_public_read ON public.legal_jurisprudencia FOR SELECT USING (true);
DROP TRIGGER IF EXISTS trg_legal_jurisprudencia_updated ON public.legal_jurisprudencia;
CREATE TRIGGER trg_legal_jurisprudencia_updated BEFORE UPDATE ON public.legal_jurisprudencia
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 6. legal_theses — isolated theses (tesis aisladas), not yet binding.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.legal_theses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_number text UNIQUE,
  title text NOT NULL,
  body text NOT NULL,
  issuing_body text,
  epoca text,
  published_at date,
  source_url text,
  verification_status public.legal_verification_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.legal_theses TO authenticated, anon;
GRANT ALL ON public.legal_theses TO service_role;
ALTER TABLE public.legal_theses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_theses_public_read ON public.legal_theses;
CREATE POLICY legal_theses_public_read ON public.legal_theses FOR SELECT USING (true);
DROP TRIGGER IF EXISTS trg_legal_theses_updated ON public.legal_theses;
CREATE TRIGGER trg_legal_theses_updated BEFORE UPDATE ON public.legal_theses
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 7. legal_regulations — reglamentos/normas that implement a statute
--    (distinct from the statute itself).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.legal_regulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  implements_authority_id uuid REFERENCES public.legal_authorities(id) ON DELETE SET NULL,
  title text NOT NULL,
  issuer text,
  jurisdiction text,
  published_at date,
  effective_at date,
  body text,
  source_url text,
  verification_status public.legal_verification_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.legal_regulations TO authenticated, anon;
GRANT ALL ON public.legal_regulations TO service_role;
ALTER TABLE public.legal_regulations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_regulations_public_read ON public.legal_regulations;
CREATE POLICY legal_regulations_public_read ON public.legal_regulations FOR SELECT USING (true);
DROP TRIGGER IF EXISTS trg_legal_regulations_updated ON public.legal_regulations;
CREATE TRIGGER trg_legal_regulations_updated BEFORE UPDATE ON public.legal_regulations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ============================================================
-- 8. legal_topics / legal_keywords — taxonomy for search/browse, plus
--    join tables linking them to any authority-like entity.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.legal_topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  parent_topic_id uuid REFERENCES public.legal_topics(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.legal_topics TO authenticated, anon;
GRANT ALL ON public.legal_topics TO service_role;
ALTER TABLE public.legal_topics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_topics_public_read ON public.legal_topics;
CREATE POLICY legal_topics_public_read ON public.legal_topics FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.legal_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.legal_keywords TO authenticated, anon;
GRANT ALL ON public.legal_keywords TO service_role;
ALTER TABLE public.legal_keywords ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_keywords_public_read ON public.legal_keywords;
CREATE POLICY legal_keywords_public_read ON public.legal_keywords FOR SELECT USING (true);

-- Generic polymorphic tagging: entity_type identifies which table
-- entity_id points into (authority | article | precedent | jurisprudencia
-- | thesis | regulation). No FK across a polymorphic column — enforced at
-- the application layer, same pattern used elsewhere for case_findings'
-- source_module prefix matching.
CREATE TABLE IF NOT EXISTS public.legal_topic_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.legal_topics(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('authority','article','precedent','jurisprudencia','thesis','regulation')),
  entity_id uuid NOT NULL,
  UNIQUE (topic_id, entity_type, entity_id)
);
GRANT SELECT ON public.legal_topic_links TO authenticated, anon;
GRANT ALL ON public.legal_topic_links TO service_role;
ALTER TABLE public.legal_topic_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_topic_links_public_read ON public.legal_topic_links;
CREATE POLICY legal_topic_links_public_read ON public.legal_topic_links FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS legal_topic_links_entity_idx ON public.legal_topic_links(entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.legal_keyword_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id uuid NOT NULL REFERENCES public.legal_keywords(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('authority','article','precedent','jurisprudencia','thesis','regulation')),
  entity_id uuid NOT NULL,
  UNIQUE (keyword_id, entity_type, entity_id)
);
GRANT SELECT ON public.legal_keyword_links TO authenticated, anon;
GRANT ALL ON public.legal_keyword_links TO service_role;
ALTER TABLE public.legal_keyword_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS legal_keyword_links_public_read ON public.legal_keyword_links;
CREATE POLICY legal_keyword_links_public_read ON public.legal_keyword_links FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS legal_keyword_links_entity_idx ON public.legal_keyword_links(entity_type, entity_id);

-- ============================================================
-- 9. authority_relationships — the "requires / supported by / contradicted
--    by / overruled by" graph edges from the spec, kept polymorphic like
--    the topic/keyword links above so it can connect any entity type.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.authority_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_type text NOT NULL CHECK (from_type IN ('authority','article','precedent','jurisprudencia','thesis','regulation')),
  from_id uuid NOT NULL,
  relationship text NOT NULL CHECK (relationship IN
    ('requires','interprets','amends','repeals','supersedes','contradicts','cites','overruled_by')),
  to_type text NOT NULL CHECK (to_type IN ('authority','article','precedent','jurisprudencia','thesis','regulation')),
  to_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.authority_relationships TO authenticated, anon;
GRANT ALL ON public.authority_relationships TO service_role;
ALTER TABLE public.authority_relationships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authority_relationships_public_read ON public.authority_relationships;
CREATE POLICY authority_relationships_public_read ON public.authority_relationships FOR SELECT USING (true);
CREATE INDEX IF NOT EXISTS authority_relationships_from_idx ON public.authority_relationships(from_type, from_id);
CREATE INDEX IF NOT EXISTS authority_relationships_to_idx ON public.authority_relationships(to_type, to_id);

-- ============================================================
-- 10. citation_cache — memoized resolution of an AI-produced citation
--     string to its verified authority/article, so repeated identical
--     citations (very common — same statute cited across many findings in
--     one case) don't re-run the lookup query every time.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.citation_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  citation_text text NOT NULL UNIQUE,
  resolved_article_id uuid REFERENCES public.legal_articles(id) ON DELETE SET NULL,
  resolved_authority_id uuid REFERENCES public.legal_authorities(id) ON DELETE SET NULL,
  verification_status public.legal_verification_status NOT NULL DEFAULT 'pending',
  last_checked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.citation_cache TO authenticated, anon;
GRANT ALL ON public.citation_cache TO service_role;
ALTER TABLE public.citation_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS citation_cache_public_read ON public.citation_cache;
CREATE POLICY citation_cache_public_read ON public.citation_cache FOR SELECT USING (true);

-- ============================================================
-- 11. Register the 6 remaining connector codes (dof, scjn, tfja already
--     exist from the earlier migration — this adds the rest of the
--     spec's list). All 'planned' until a real connector is built and
--     verified, same discipline as dof/scjn.
-- ============================================================
INSERT INTO public.legal_source_connectors (code, name, description, status) VALUES
  ('cjf', 'Consejo de la Judicatura Federal', 'Información y acuerdos del CJF', 'planned'),
  ('tepjf', 'Tribunal Electoral del Poder Judicial de la Federación', 'Resoluciones electorales', 'planned'),
  ('congreso', 'Congreso de la Unión', 'Actividad legislativa federal (iniciativas, reformas)', 'planned'),
  ('state_gazettes', 'Periódicos Oficiales Estatales', 'Publicaciones oficiales de los 32 estados', 'planned'),
  ('state_scj', 'Tribunales Superiores de Justicia Estatales', 'Resoluciones de tribunales estatales', 'planned')
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 12. Search support: trigram index for fuzzy/ILIKE search performance
--     across the article/authority text fields the search function below
--     queries.
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS legal_authorities_title_trgm_idx ON public.legal_authorities USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS legal_articles_body_trgm_idx ON public.legal_articles USING gin (body gin_trgm_ops);
CREATE INDEX IF NOT EXISTS legal_jurisprudencia_title_trgm_idx ON public.legal_jurisprudencia USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS legal_theses_title_trgm_idx ON public.legal_theses USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS legal_precedents_case_number_trgm_idx ON public.legal_precedents USING gin (case_number gin_trgm_ops);
