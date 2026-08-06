-- 1) Re-scope user-data policies from the broad `public` role to `authenticated`.
ALTER POLICY "users read own audit logs" ON public.audit_logs TO authenticated;
ALTER POLICY "Users delete timeline events for their own cases" ON public.case_timeline_events TO authenticated;
ALTER POLICY "pages owner all" ON public.document_pages TO authenticated;
ALTER POLICY "Users update image intelligence for their own cases" ON public.image_intelligence TO authenticated;
ALTER POLICY "Users delete image intelligence for their own cases" ON public.image_intelligence TO authenticated;
ALTER POLICY "Users manage own settings" ON public.user_settings TO authenticated;

-- 2) Legal reference library: readable by signed-in users only (anon holds no
--    table grants on these already; this makes the intent explicit).
ALTER POLICY "authority_relationships_public_read" ON public.authority_relationships TO authenticated;
ALTER POLICY "citation_cache_public_read" ON public.citation_cache TO authenticated;
ALTER POLICY "legal_amendments_public_read" ON public.legal_amendments TO authenticated;
ALTER POLICY "legal_articles_public_read" ON public.legal_articles TO authenticated;
ALTER POLICY "legal_auth_public_read" ON public.legal_authorities TO authenticated;
ALTER POLICY "legal_authority_versions public read" ON public.legal_authority_versions TO authenticated;
ALTER POLICY "legal_cite_public_read" ON public.legal_citations TO authenticated;
ALTER POLICY "legal_jurisprudencia_public_read" ON public.legal_jurisprudencia TO authenticated;
ALTER POLICY "legal_keyword_links_public_read" ON public.legal_keyword_links TO authenticated;
ALTER POLICY "legal_keywords_public_read" ON public.legal_keywords TO authenticated;
ALTER POLICY "legal_precedents_public_read" ON public.legal_precedents TO authenticated;
ALTER POLICY "legal_profiles_public_read" ON public.legal_profiles TO authenticated;
ALTER POLICY "legal_regulations_public_read" ON public.legal_regulations TO authenticated;
ALTER POLICY "legal_theses_public_read" ON public.legal_theses TO authenticated;
ALTER POLICY "legal_topic_links_public_read" ON public.legal_topic_links TO authenticated;
ALTER POLICY "legal_topics_public_read" ON public.legal_topics TO authenticated;

-- 3) Fixed search_path on the only function missing one.
ALTER FUNCTION public.closing_readiness(uuid) SET search_path = public;

-- 4) Revoke EXECUTE from API roles on routines that are internal-only.
--    Server-side (service_role) callers are unaffected.
REVOKE EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_grant_beta_access(text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tg_normalize_finding_type() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.plan_seat_limit(text) FROM anon, PUBLIC;

-- Keep the admin-tier RPCs callable by signed-in users: each one verifies the
-- caller's role internally, and the app invokes them with the user's session.
GRANT EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_grant_beta_access(text, text) TO authenticated;
-- closing_readiness is called by the signed-in real-estate view.
GRANT EXECUTE ON FUNCTION public.closing_readiness(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_engine_run(uuid, uuid, text, jsonb) TO service_role;