
-- 1. Lock down user_roles: prevent privilege escalation
CREATE POLICY "Only admins can insert roles" ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can update roles" ON public.user_roles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete roles" ON public.user_roles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. Storage: prevent overwriting other users' case files
CREATE POLICY "Users can update their own case files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'case-files' AND auth.uid()::text = (storage.foldername(name))[1])
  WITH CHECK (bucket_id = 'case-files' AND auth.uid()::text = (storage.foldername(name))[1]);

-- 3. Revoke EXECUTE on SECURITY DEFINER functions from anon/authenticated.
-- handle_new_user and tg_set_updated_at are trigger-only functions; triggers run regardless of EXECUTE grants.
-- has_role is referenced inside RLS policies, which run under the policy owner's privileges; revoking
-- EXECUTE from anon/authenticated prevents direct RPC calls but does not break policy evaluation.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
