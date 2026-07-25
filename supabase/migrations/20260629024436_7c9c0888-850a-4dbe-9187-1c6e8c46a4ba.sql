DROP POLICY IF EXISTS "service inserts audit logs" ON public.audit_logs;
REVOKE INSERT ON public.audit_logs FROM authenticated;