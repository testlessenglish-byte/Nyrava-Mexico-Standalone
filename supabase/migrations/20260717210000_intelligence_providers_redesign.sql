-- ============================================================
-- Intelligence Providers redesign: provider health, provider
-- failover order, and per-feature intelligence routing.
-- ============================================================

-- ------------------------------------------------------------
-- user_ai_keys: track outcome of the last live probe so the UI
-- can show a real Healthy / Slow / Offline badge per provider
-- instead of just "last used".
-- ------------------------------------------------------------
ALTER TABLE public.user_ai_keys ADD COLUMN IF NOT EXISTS last_test_ok BOOLEAN;
ALTER TABLE public.user_ai_keys ADD COLUMN IF NOT EXISTS last_test_latency_ms INTEGER;
ALTER TABLE public.user_ai_keys ADD COLUMN IF NOT EXISTS last_test_error TEXT;

-- ------------------------------------------------------------
-- user_provider_order: the failover order across providers
-- (Primary / Secondary / Third / Backup / Final Backup). This is
-- distinct from user_ai_keys.priority, which only orders keys
-- *within* a single provider's rotation.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_provider_order (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider public.ai_provider NOT NULL,
  order_index INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_user_provider_order_user ON public.user_provider_order(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_provider_order TO authenticated;
GRANT ALL ON public.user_provider_order TO service_role;

ALTER TABLE public.user_provider_order ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own provider order"
  ON public.user_provider_order
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER user_provider_order_updated_at
  BEFORE UPDATE ON public.user_provider_order
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ------------------------------------------------------------
-- user_intelligence_features: per-feature routing preference.
-- provider = 'auto' lets Nyrava pick from the failover order
-- above; otherwise the feature is pinned to one provider.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_intelligence_features (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'auto',
  mode TEXT NOT NULL DEFAULT 'balanced',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, feature_key)
);

CREATE INDEX IF NOT EXISTS idx_user_intelligence_features_user ON public.user_intelligence_features(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_intelligence_features TO authenticated;
GRANT ALL ON public.user_intelligence_features TO service_role;

ALTER TABLE public.user_intelligence_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own feature routing"
  ON public.user_intelligence_features
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER user_intelligence_features_updated_at
  BEFORE UPDATE ON public.user_intelligence_features
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
