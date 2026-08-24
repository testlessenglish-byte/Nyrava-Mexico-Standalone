begin;

-- Comprehensive Care accepts common case-document, image, archive, email,
-- audio and video formats while continuing to reject executable content.
update storage.buckets
set file_size_limit=104857600,
    allowed_mime_types=array[
      'application/octet-stream',
      'application/pdf','application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.text',
      'application/vnd.oasis.opendocument.spreadsheet',
      'application/vnd.oasis.opendocument.presentation',
      'application/rtf','text/rtf','text/plain','text/csv','text/tab-separated-values',
      'application/json','application/xml','text/xml',
      'image/jpeg','image/png','image/webp','image/gif','image/bmp','image/tiff',
      'image/heic','image/heif','image/svg+xml',
      'application/zip','application/x-zip-compressed',
      'application/vnd.rar','application/x-rar-compressed',
      'application/x-7z-compressed','application/x-tar','application/gzip','application/x-gzip',
      'audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/aac','audio/ogg','audio/flac','audio/x-m4a',
      'video/mp4','video/quicktime','video/webm','video/x-msvideo','video/mpeg','video/x-matroska',
      'message/rfc822','application/vnd.ms-outlook','application/dicom'
    ]::text[]
where id='social-case-files';

-- Media is available by default for a program and can still be explicitly
-- disabled by setting settings.allow_media_uploads=false.
create or replace function public.social_media_upload_allowed(
  p_case uuid,p_mime text,p_user uuid default auth.uid()
) returns boolean
language sql stable security definer set search_path=public,pg_temp
as $media_upload$
  select
    (
      lower(coalesce(p_mime,'')) not like 'audio/%'
      and lower(coalesce(p_mime,'')) not like 'video/%'
    )
    or exists(
      select 1
      from public.social_cases c
      join public.social_programs p on p.id=c.program_id and p.org_id=c.org_id
      where c.id=p_case
        and c.deleted_at is null
        and p.active
        and coalesce((p.settings->>'allow_media_uploads')::boolean,true)
        and public.social_is_org_member(c.org_id,p_user)
    )
$media_upload$;

revoke all on function public.social_media_upload_allowed(uuid,text,uuid) from public,anon;
grant execute on function public.social_media_upload_allowed(uuid,text,uuid) to authenticated;

-- Validate the filename at the storage boundary as well as in the application.
drop policy if exists social_case_files_insert on storage.objects;
create policy social_case_files_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3] in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record'
  )
  and storage.filename(name) ~* '\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|txt|csv|tsv|json|xml|jpg|jpeg|png|webp|gif|bmp|tif|tiff|heic|heif|svg|zip|rar|7z|tar|gz|tgz|mp3|wav|m4a|aac|ogg|oga|flac|mp4|mov|m4v|webm|avi|mpeg|mpg|mkv|eml|msg|dcm)$'
  and public.social_can_access_case(
    ((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid()
  )
  and public.social_media_upload_allowed(
    ((storage.foldername(name))[2])::uuid,metadata->>'mimetype',auth.uid()
  )
);

drop policy if exists social_case_files_update on storage.objects;
create policy social_case_files_update on storage.objects
for update to authenticated
using (
  bucket_id='social-case-files'
  and (storage.foldername(name))[3] in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record'
  )
  and public.social_can_access_case(
    ((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid()
  )
)
with check (
  bucket_id='social-case-files'
  and (storage.foldername(name))[1] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[2] ~* '^[0-9a-f-]{36}$'
  and (storage.foldername(name))[3] in (
    'general_case_record','social_work_record','legal_privileged_record',
    'psychosocial_restricted_record','medical_restricted_record','child_protection_restricted_record'
  )
  and storage.filename(name) ~* '\.(pdf|doc|docx|xls|xlsx|ppt|pptx|odt|ods|odp|rtf|txt|csv|tsv|json|xml|jpg|jpeg|png|webp|gif|bmp|tif|tiff|heic|heif|svg|zip|rar|7z|tar|gz|tgz|mp3|wav|m4a|aac|ogg|oga|flac|mp4|mov|m4v|webm|avi|mpeg|mpg|mkv|eml|msg|dcm)$'
  and public.social_can_access_case(
    ((storage.foldername(name))[2])::uuid,(storage.foldername(name))[3],true,auth.uid()
  )
  and public.social_media_upload_allowed(
    ((storage.foldername(name))[2])::uuid,metadata->>'mimetype',auth.uid()
  )
);

notify pgrst,'reload schema';

commit;
