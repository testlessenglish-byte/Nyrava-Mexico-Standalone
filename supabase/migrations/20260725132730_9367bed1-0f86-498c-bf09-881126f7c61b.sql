
-- RLS policies for the private 'case-files' bucket.
-- Convention: object path is '<user_id>/<case_id>/<filename>'.
-- Users can only touch objects under their own user-id folder.

CREATE POLICY "case-files: users read own"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'case-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "case-files: users insert own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'case-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "case-files: users update own"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'case-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'case-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "case-files: users delete own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'case-files'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
