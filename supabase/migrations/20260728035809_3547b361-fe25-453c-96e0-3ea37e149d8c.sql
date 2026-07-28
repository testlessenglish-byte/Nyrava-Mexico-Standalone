CREATE OR REPLACE FUNCTION public.prevent_user_settings_firm_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.firm_id IS DISTINCT FROM OLD.firm_id THEN
    -- service_role / internal jobs bypass; admins may reassign.
    IF auth.uid() IS NULL OR public.is_admin_tier(auth.uid()) THEN
      RETURN NEW;
    END IF;
    -- First-time assignment (no firm yet) is allowed.
    IF OLD.firm_id IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'No puede cambiar su firma directamente. Solicite el cambio a un administrador.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_user_settings_firm_change ON public.user_settings;
CREATE TRIGGER trg_prevent_user_settings_firm_change
BEFORE UPDATE ON public.user_settings
FOR EACH ROW EXECUTE FUNCTION public.prevent_user_settings_firm_change();

REVOKE EXECUTE ON FUNCTION public.prevent_user_settings_firm_change() FROM PUBLIC, anon, authenticated;