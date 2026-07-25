
-- Storage policies for matter-documents bucket
-- Path convention: {org_id}/{matter_id}/{document_id}/{version}/{filename}
CREATE POLICY "matter_docs_member_read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'matter-documents'
  AND public.is_org_member(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "matter_docs_contrib_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'matter-documents'
  AND public.can_contribute_org(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "matter_docs_contrib_update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'matter-documents'
  AND public.can_contribute_org(auth.uid(), ((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "matter_docs_admin_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'matter-documents'
  AND public.can_manage_org(auth.uid(), ((storage.foldername(name))[1])::uuid)
);
