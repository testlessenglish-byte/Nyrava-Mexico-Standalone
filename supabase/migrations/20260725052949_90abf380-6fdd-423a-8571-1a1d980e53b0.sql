
-- =========================================================
-- Enums
-- =========================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'lawyer', 'paralegal', 'viewer');
CREATE TYPE public.matter_type AS ENUM (
  'litigation','criminal','civil','commercial','labor','family',
  'constitutional','administrative','corporate','tax','immigration',
  'contract','advisory','compliance','transaction'
);
CREATE TYPE public.matter_status AS ENUM ('intake','active','on_hold','closed','archived');
CREATE TYPE public.matter_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE public.membership_status AS ENUM ('active','invited','suspended');
CREATE TYPE public.task_status AS ENUM ('todo','in_progress','blocked','done','cancelled');

-- =========================================================
-- Shared updated_at trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- =========================================================
-- Profiles
-- =========================================================
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  display_name text,
  avatar_url text,
  locale text NOT NULL DEFAULT 'es-MX',
  default_org_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_self_insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-create profile on new auth user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- Global user_roles + has_role
-- =========================================================
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles_self_select" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- =========================================================
-- Organizations
-- =========================================================
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  edition text NOT NULL DEFAULT 'MX',
  plan text NOT NULL DEFAULT 'trial',
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organizations TO authenticated;
GRANT ALL ON public.organizations TO service_role;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_orgs_updated BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- Memberships
-- =========================================================
CREATE TABLE public.org_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_in_org public.org_role NOT NULL DEFAULT 'viewer',
  status public.membership_status NOT NULL DEFAULT 'active',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (org_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_memberships TO authenticated;
GRANT ALL ON public.org_memberships TO service_role;
ALTER TABLE public.org_memberships ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_memb_updated BEFORE UPDATE ON public.org_memberships FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Security-definer helpers (avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.is_org_member(_user uuid, _org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_memberships
    WHERE user_id = _user AND org_id = _org
      AND status = 'active' AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.org_role_of(_user uuid, _org uuid)
RETURNS public.org_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role_in_org FROM public.org_memberships
  WHERE user_id = _user AND org_id = _org
    AND status = 'active' AND deleted_at IS NULL
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_org(_user uuid, _org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.org_role_of(_user, _org) IN ('owner','admin');
$$;

CREATE OR REPLACE FUNCTION public.can_contribute_org(_user uuid, _org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.org_role_of(_user, _org) IN ('owner','admin','lawyer','paralegal');
$$;

-- Organization policies
CREATE POLICY "orgs_member_select" ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), id));
CREATE POLICY "orgs_owner_update" ON public.organizations FOR UPDATE TO authenticated
  USING (public.can_manage_org(auth.uid(), id)) WITH CHECK (public.can_manage_org(auth.uid(), id));
CREATE POLICY "orgs_authenticated_insert" ON public.organizations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- Membership policies
CREATE POLICY "memb_self_or_org_select" ON public.org_memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_member(auth.uid(), org_id));
CREATE POLICY "memb_admin_write" ON public.org_memberships FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_org(auth.uid(), org_id));
CREATE POLICY "memb_admin_update" ON public.org_memberships FOR UPDATE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id)) WITH CHECK (public.can_manage_org(auth.uid(), org_id));
CREATE POLICY "memb_admin_delete" ON public.org_memberships FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

-- Bootstrap: when creator inserts org, auto-add owner membership
CREATE OR REPLACE FUNCTION public.tg_org_bootstrap_owner()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO public.org_memberships (org_id, user_id, role_in_org, status)
    VALUES (NEW.id, NEW.created_by, 'owner', 'active')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_org_bootstrap AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.tg_org_bootstrap_owner();

-- =========================================================
-- Matters (generalized "matter management")
-- =========================================================
CREATE TABLE public.matters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  reference_code text,
  matter_type public.matter_type NOT NULL DEFAULT 'litigation',
  practice_area text,
  jurisdiction text,
  court text,
  docket_number text,
  status public.matter_status NOT NULL DEFAULT 'intake',
  priority public.matter_priority NOT NULL DEFAULT 'normal',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  lead_lawyer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_name text,
  description text,
  tags text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX matters_org_idx ON public.matters (org_id, status);
CREATE INDEX matters_type_idx ON public.matters (org_id, matter_type);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matters TO authenticated;
GRANT ALL ON public.matters TO service_role;
ALTER TABLE public.matters ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_matters_updated BEFORE UPDATE ON public.matters FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE POLICY "matters_member_select" ON public.matters FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id) AND deleted_at IS NULL);
CREATE POLICY "matters_contrib_insert" ON public.matters FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY "matters_manage_update" ON public.matters FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id)) WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY "matters_admin_delete" ON public.matters FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

-- =========================================================
-- Generic per-matter child table macro (via repeated blocks)
-- =========================================================

-- Parties
CREATE TABLE public.matter_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  party_type text NOT NULL,
  name text NOT NULL,
  role_description text,
  contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_parties TO authenticated;
GRANT ALL ON public.matter_parties TO service_role;
ALTER TABLE public.matter_parties ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_parties_updated BEFORE UPDATE ON public.matter_parties FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE POLICY "parties_member_select" ON public.matter_parties FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id) AND deleted_at IS NULL);
CREATE POLICY "parties_contrib_write" ON public.matter_parties FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY "parties_contrib_update" ON public.matter_parties FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id)) WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY "parties_admin_delete" ON public.matter_parties FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

-- Events
CREATE TABLE public.matter_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  scheduled_at timestamptz,
  location text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_events TO authenticated;
GRANT ALL ON public.matter_events TO service_role;
ALTER TABLE public.matter_events ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_events_updated BEFORE UPDATE ON public.matter_events FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE POLICY "events_member_select" ON public.matter_events FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id) AND deleted_at IS NULL);
CREATE POLICY "events_contrib_write" ON public.matter_events FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY "events_contrib_update" ON public.matter_events FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id)) WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY "events_admin_delete" ON public.matter_events FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

-- Documents (metadata only)
CREATE TABLE public.matter_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  doc_type text,
  storage_path text,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_documents TO authenticated;
GRANT ALL ON public.matter_documents TO service_role;
ALTER TABLE public.matter_documents ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_docs_updated BEFORE UPDATE ON public.matter_documents FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE POLICY "docs_member_select" ON public.matter_documents FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id) AND deleted_at IS NULL);
CREATE POLICY "docs_contrib_write" ON public.matter_documents FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY "docs_contrib_update" ON public.matter_documents FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id)) WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY "docs_admin_delete" ON public.matter_documents FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

-- Notes
CREATE TABLE public.matter_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_notes TO authenticated;
GRANT ALL ON public.matter_notes TO service_role;
ALTER TABLE public.matter_notes ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_notes_updated BEFORE UPDATE ON public.matter_notes FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE POLICY "notes_member_select" ON public.matter_notes FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id) AND deleted_at IS NULL);
CREATE POLICY "notes_contrib_insert" ON public.matter_notes FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id) AND author_id = auth.uid());
CREATE POLICY "notes_author_update" ON public.matter_notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid()) WITH CHECK (author_id = auth.uid());
CREATE POLICY "notes_author_or_admin_delete" ON public.matter_notes FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.can_manage_org(auth.uid(), org_id));

-- Tasks
CREATE TABLE public.matter_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date date,
  status public.task_status NOT NULL DEFAULT 'todo',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matter_tasks TO authenticated;
GRANT ALL ON public.matter_tasks TO service_role;
ALTER TABLE public.matter_tasks ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_tasks_updated BEFORE UPDATE ON public.matter_tasks FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE POLICY "tasks_member_select" ON public.matter_tasks FOR SELECT TO authenticated
  USING (public.is_org_member(auth.uid(), org_id) AND deleted_at IS NULL);
CREATE POLICY "tasks_contrib_write" ON public.matter_tasks FOR INSERT TO authenticated
  WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY "tasks_contrib_update" ON public.matter_tasks FOR UPDATE TO authenticated
  USING (public.can_contribute_org(auth.uid(), org_id)) WITH CHECK (public.can_contribute_org(auth.uid(), org_id));
CREATE POLICY "tasks_admin_delete" ON public.matter_tasks FOR DELETE TO authenticated
  USING (public.can_manage_org(auth.uid(), org_id));

-- Audit log
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_member_select" ON public.audit_log FOR SELECT TO authenticated
  USING (org_id IS NULL OR public.is_org_member(auth.uid(), org_id));
