-- Harden firm_id assignment on public.user_settings.
-- The existing BEFORE UPDATE trigger + column REVOKE covered updates, but the
-- "own settings" FOR ALL policy still allowed a user to INSERT their own
-- settings row with an arbitrary firm_id, which same_firm() then trusts for
-- cross-user read access to cases/reports/canonical_analysis.

CREATE OR REPLACE FUNCTION public.tg_protect_user_settings_firm_id_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.firm_id IS NOT NULL THEN
    IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
            OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
      NEW.firm_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_protect_user_settings_firm_id_insert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_user_settings_firm_id_insert ON public.user_settings;
CREATE TRIGGER protect_user_settings_firm_id_insert
  BEFORE INSERT ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_protect_user_settings_firm_id_insert();

-- Also stop a firm_admin from moving themselves into another firm: only
-- platform admins (or the service role, which bypasses RLS/triggers checks
-- via has_role on a service context) may change an existing firm_id.
CREATE OR REPLACE FUNCTION public.tg_protect_user_settings_firm_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.firm_id IS DISTINCT FROM OLD.firm_id THEN
    IF NOT (public.has_role(auth.uid(), 'admin'::app_role)
            OR public.has_role(auth.uid(), 'super_admin'::app_role)) THEN
      NEW.firm_id := OLD.firm_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE INSERT (firm_id) ON public.user_settings FROM authenticated;
