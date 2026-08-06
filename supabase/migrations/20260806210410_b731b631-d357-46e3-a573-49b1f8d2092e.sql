-- 1. firm_invites: scope admin visibility to the same firm
DROP POLICY IF EXISTS firm_invites_read ON public.firm_invites;
CREATE POLICY firm_invites_read ON public.firm_invites
FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.user_settings us
    WHERE us.user_id = auth.uid()
      AND us.firm_id = firm_invites.firm_id
  )
);

-- 2. plan_entitlements: signed-in users only
DROP POLICY IF EXISTS plan_ent_public_read ON public.plan_entitlements;
CREATE POLICY plan_ent_read_authenticated ON public.plan_entitlements
FOR SELECT TO authenticated
USING (true);
REVOKE SELECT ON public.plan_entitlements FROM anon;
GRANT SELECT ON public.plan_entitlements TO authenticated;
GRANT ALL ON public.plan_entitlements TO service_role;

-- 3. SECURITY DEFINER helpers: only answer for the caller.
--    auth.uid() IS NULL means a trusted server-side (service_role/trigger)
--    context, which keeps triggers and background jobs working.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (auth.uid() IS NULL OR _user_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_admin_tier(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (auth.uid() IS NULL OR _user_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.user_roles
                 WHERE user_id = _user_id AND role IN ('admin','super_admin','firm_admin'))
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (auth.uid() IS NULL OR _user_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
$$;

CREATE OR REPLACE FUNCTION public.is_case_manager(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (auth.uid() IS NULL OR _user_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.user_roles
                 WHERE user_id = _user_id AND role IN ('case_manager','admin','super_admin','firm_admin'))
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(_user uuid, _org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (auth.uid() IS NULL OR _user = auth.uid())
     AND EXISTS (
       SELECT 1 FROM public.org_memberships
       WHERE user_id = _user AND org_id = _org
         AND status = 'active' AND deleted_at IS NULL
     )
$$;

CREATE OR REPLACE FUNCTION public.org_role_of(_user uuid, _org uuid)
RETURNS org_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT role_in_org FROM public.org_memberships
  WHERE user_id = _user AND org_id = _org
    AND status = 'active' AND deleted_at IS NULL
    AND (auth.uid() IS NULL OR _user = auth.uid())
  LIMIT 1
$$;
