
-- 1. Fix mutable search_path
ALTER FUNCTION public.plan_seat_limit(text) SET search_path = public;

-- 2. Revoke anon EXECUTE from all SECURITY DEFINER public functions
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;

-- 3. Revoke authenticated EXECUTE from admin-only SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.admin_get_user_id_by_email(text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_firms_with_seats() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_pending_beta_invites() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_list_users_with_subscriptions() FROM authenticated;

-- 4. demo-cases: remove broad listing policy; public bucket URLs still work
DROP POLICY IF EXISTS "Anyone can read demo-cases storage objects" ON storage.objects;

-- 5. ai_providers: explicit admin-only write policies (ALL already covers, but be explicit)
DROP POLICY IF EXISTS "ai_providers admin insert" ON public.ai_providers;
DROP POLICY IF EXISTS "ai_providers admin update" ON public.ai_providers;
DROP POLICY IF EXISTS "ai_providers admin delete" ON public.ai_providers;
CREATE POLICY "ai_providers admin insert" ON public.ai_providers
  FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "ai_providers admin update" ON public.ai_providers
  FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "ai_providers admin delete" ON public.ai_providers
  FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::app_role));
