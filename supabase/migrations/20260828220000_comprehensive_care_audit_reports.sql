-- 20260828220000_comprehensive_care_audit_reports.sql
-- Comprehensive Care Audit & Accountability Reporting System (Primary Subscriber Only)

CREATE TABLE IF NOT EXISTS public.social_audit_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  social_case_id UUID REFERENCES public.social_cases(id) ON DELETE SET NULL,
  report_id TEXT NOT NULL UNIQUE,
  report_scope TEXT NOT NULL CHECK (report_scope IN ('individual_case', 'organization_wide', 'community_support', 'financial_activity', 'services_outcomes', 'full_audit')),
  reporting_period TEXT NOT NULL DEFAULT 'all_history' CHECK (reporting_period IN ('all_history', 'this_month', 'last_month', 'this_quarter', 'this_year', 'custom')),
  start_date DATE,
  end_date DATE,
  language TEXT NOT NULL DEFAULT 'es' CHECK (language IN ('es', 'en')),
  classification TEXT NOT NULL DEFAULT 'confidential' CHECK (classification IN ('internal', 'confidential', 'restricted', 'external_distribution')),
  generated_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  dataset_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  checksum_sha256 TEXT NOT NULL,
  pdf_storage_path TEXT,
  pdf_base64 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_audit_report_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id TEXT NOT NULL,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  recipient_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_social_reports_org ON public.social_audit_reports(org_id);
CREATE INDEX IF NOT EXISTS idx_social_reports_case ON public.social_audit_reports(social_case_id);
CREATE INDEX IF NOT EXISTS idx_social_reports_code ON public.social_audit_reports(report_id);
CREATE INDEX IF NOT EXISTS idx_social_report_emails_org ON public.social_audit_report_emails(org_id);

-- Enable RLS
ALTER TABLE public.social_audit_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_audit_report_emails ENABLE ROW LEVEL SECURITY;

-- RLS: Strict Primary Subscriber Only
CREATE POLICY "Primary subscribers can view their audit reports"
  ON public.social_audit_reports
  FOR SELECT
  TO authenticated
  USING (public.is_primary_subscriber(org_id));

CREATE POLICY "Primary subscribers can insert audit reports"
  ON public.social_audit_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_primary_subscriber(org_id));

CREATE POLICY "Primary subscribers can view report email logs"
  ON public.social_audit_report_emails
  FOR SELECT
  TO authenticated
  USING (public.is_primary_subscriber(org_id));

CREATE POLICY "Primary subscribers can insert report email logs"
  ON public.social_audit_report_emails
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_primary_subscriber(org_id));

