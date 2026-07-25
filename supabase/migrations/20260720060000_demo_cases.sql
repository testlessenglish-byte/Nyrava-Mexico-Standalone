-- "Experience Nyrava" homepage demos: admin-curated sample cases shown to
-- signed-out visitors so they can explore a full case workspace (evidence,
-- timeline, witnesses, motions, report) without uploading their own files
-- or creating an account.

CREATE TABLE public.demo_cases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  case_type text NOT NULL,
  summary text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  thumbnail_path text,
  published boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.demo_case_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  demo_case_id uuid NOT NULL REFERENCES public.demo_cases(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN (
    'evidence', 'timeline', 'witness_analysis', 'motion',
    'attorney_report', 'final_report', 'other'
  )),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  file_size bigint NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only one document per fixed slot (Evidence, Timeline, Witness Analysis,
-- Motion, Attorney Report, Final Report). "other" is unlimited so an admin
-- can attach an entire supporting case folder (police report, 911 call,
-- body-cam transcript, etc.) alongside the fixed slots.
CREATE UNIQUE INDEX demo_case_documents_one_per_slot
  ON public.demo_case_documents (demo_case_id, doc_type)
  WHERE doc_type <> 'other';

CREATE INDEX demo_case_documents_case_idx ON public.demo_case_documents (demo_case_id);

GRANT SELECT ON public.demo_cases TO anon;
GRANT SELECT ON public.demo_cases TO authenticated;
GRANT ALL ON public.demo_cases TO service_role;

GRANT SELECT ON public.demo_case_documents TO anon;
GRANT SELECT ON public.demo_case_documents TO authenticated;
GRANT ALL ON public.demo_case_documents TO service_role;

ALTER TABLE public.demo_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_case_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view published demo cases"
  ON public.demo_cases FOR SELECT
  USING (published = true);

CREATE POLICY "Admins can view all demo cases"
  ON public.demo_cases FOR SELECT
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can insert demo cases"
  ON public.demo_cases FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can update demo cases"
  ON public.demo_cases FOR UPDATE
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can delete demo cases"
  ON public.demo_cases FOR DELETE
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Anyone can view documents of published demo cases"
  ON public.demo_case_documents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.demo_cases dc
    WHERE dc.id = demo_case_documents.demo_case_id AND dc.published = true
  ));

CREATE POLICY "Admins can view all demo case documents"
  ON public.demo_case_documents FOR SELECT
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can insert demo case documents"
  ON public.demo_case_documents FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE POLICY "Admins can delete demo case documents"
  ON public.demo_case_documents FOR DELETE
  TO authenticated
  USING (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid()));

CREATE TRIGGER demo_cases_set_updated_at
  BEFORE UPDATE ON public.demo_cases
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Public storage bucket for demo assets (thumbnails + demo PDFs). Public so
-- the homepage and demo viewer can embed files directly by URL with no
-- signed-URL round trip for signed-out visitors.
INSERT INTO storage.buckets (id, name, public)
VALUES ('demo-cases', 'demo-cases', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Anyone can read demo-cases storage objects"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'demo-cases');

CREATE POLICY "Admins can write demo-cases storage objects"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'demo-cases' AND (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid())));

CREATE POLICY "Admins can update demo-cases storage objects"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'demo-cases' AND (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid())))
  WITH CHECK (bucket_id = 'demo-cases' AND (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid())));

CREATE POLICY "Admins can delete demo-cases storage objects"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'demo-cases' AND (public.is_admin_tier(auth.uid()) OR public.is_super_admin(auth.uid())));

-- Seed the nine practice areas as unpublished drafts so the admin panel has
-- something to fill in immediately (upload files, write a description, then
-- flip Published on).
INSERT INTO public.demo_cases (slug, name, case_type, summary, sort_order, published) VALUES
  ('criminal-defense', 'State v. Marcus Franklin', 'criminal', 'See how Nyrava analyzes a criminal case.', 10, false),
  ('general-civil', 'Smith v. Horizon Builders', 'general_civil', 'Breach of Contract', 20, false),
  ('personal-injury', 'Johnson v. Metro Trucking', 'personal_injury', 'Motor vehicle collision case.', 30, false),
  ('medical-malpractice', 'Reyes v. Lakeside Medical Center', 'medical_malpractice', 'Surgical error case.', 40, false),
  ('employment', 'Garcia v. ABC Logistics', 'employment', 'Wrongful termination case.', 50, false),
  ('family-law', 'In re: Anderson Custody', 'family', 'Contested custody case.', 60, false),
  ('appellate', 'People v. Whitfield (Appeal)', 'appellate', 'Direct criminal appeal.', 70, false),
  ('tax-law', 'Preston v. Dept. of Revenue', 'tax_law', 'Tax assessment dispute.', 80, false),
  ('civil-rights', 'Daniels v. City of Riverton', 'civil_rights', 'Section 1983 excessive force case.', 90, false)
ON CONFLICT (slug) DO NOTHING;
