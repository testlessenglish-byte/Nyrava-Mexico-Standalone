
-- Helper: resolve or create a firm from an email address
CREATE OR REPLACE FUNCTION public.resolve_firm_for_email(_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _domain TEXT;
  _firm_id UUID;
  _name TEXT;
BEGIN
  IF _email IS NULL OR position('@' in _email) = 0 THEN RETURN NULL; END IF;
  _domain := lower(split_part(_email, '@', 2));
  IF _domain IN ('gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','proton.me','protonmail.com','aol.com','me.com','msn.com','live.com') THEN
    RETURN NULL;
  END IF;
  SELECT id INTO _firm_id FROM public.firms WHERE domain = _domain LIMIT 1;
  IF _firm_id IS NOT NULL THEN RETURN _firm_id; END IF;
  _name := initcap(split_part(_domain, '.', 1));
  INSERT INTO public.firms (name, domain) VALUES (_name, _domain)
  ON CONFLICT (domain) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO _firm_id;
  RETURN _firm_id;
END; $$;

-- Extend handle_new_user to also assign firm
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _firm_id UUID;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user') ON CONFLICT DO NOTHING;
  _firm_id := public.resolve_firm_for_email(NEW.email);
  INSERT INTO public.user_settings (user_id, firm_id)
  VALUES (NEW.id, _firm_id)
  ON CONFLICT (user_id) DO UPDATE SET firm_id = COALESCE(public.user_settings.firm_id, EXCLUDED.firm_id);
  RETURN NEW;
END; $$;

-- Trigger: stamp cases with the owner's firm at insert
CREATE OR REPLACE FUNCTION public.tg_stamp_case_firm()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.firm_id IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT firm_id INTO NEW.firm_id FROM public.user_settings WHERE user_id = NEW.user_id LIMIT 1;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS cases_stamp_firm ON public.cases;
CREATE TRIGGER cases_stamp_firm BEFORE INSERT ON public.cases
FOR EACH ROW EXECUTE FUNCTION public.tg_stamp_case_firm();

-- Helper: does caller belong to the same firm as target user?
CREATE OR REPLACE FUNCTION public.same_firm(_a UUID, _b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_settings ua
    JOIN public.user_settings ub ON ub.user_id = _b AND ua.firm_id = ub.firm_id
    WHERE ua.user_id = _a AND ua.firm_id IS NOT NULL
  );
$$;

-- Additive firm-scoped SELECT for firm admins on cases
DROP POLICY IF EXISTS cases_firm_admin_read ON public.cases;
CREATE POLICY cases_firm_admin_read ON public.cases FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'firm_admin'::app_role)
  AND public.same_firm(auth.uid(), user_id)
);

-- Backfill: create firms for existing users, then stamp user_settings and cases
DO $$
DECLARE r RECORD; _firm UUID;
BEGIN
  FOR r IN SELECT id, email FROM auth.users WHERE email IS NOT NULL LOOP
    _firm := public.resolve_firm_for_email(r.email);
    IF _firm IS NOT NULL THEN
      INSERT INTO public.user_settings (user_id, firm_id) VALUES (r.id, _firm)
      ON CONFLICT (user_id) DO UPDATE SET firm_id = COALESCE(public.user_settings.firm_id, _firm);
    END IF;
  END LOOP;
  UPDATE public.cases c SET firm_id = us.firm_id
  FROM public.user_settings us
  WHERE c.user_id = us.user_id AND c.firm_id IS NULL AND us.firm_id IS NOT NULL;
END $$;
