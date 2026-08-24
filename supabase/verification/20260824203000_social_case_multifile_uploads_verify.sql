select
  exists(select 1 from storage.buckets where id='social-case-files' and public=false) as private_bucket,
  exists(select 1 from storage.buckets where id='social-case-files' and file_size_limit=104857600) as size_limit_ok,
  exists(select 1 from storage.buckets where id='social-case-files' and 'application/pdf'=any(allowed_mime_types)) as pdf_enabled,
  exists(select 1 from storage.buckets where id='social-case-files' and 'application/zip'=any(allowed_mime_types)) as zip_enabled,
  exists(select 1 from storage.buckets where id='social-case-files' and 'image/jpeg'=any(allowed_mime_types)) as images_enabled,
  exists(select 1 from storage.buckets where id='social-case-files' and 'audio/mpeg'=any(allowed_mime_types)) as audio_enabled,
  exists(select 1 from storage.buckets where id='social-case-files' and 'video/mp4'=any(allowed_mime_types)) as video_enabled,
  to_regprocedure('public.social_media_upload_allowed(uuid,text,uuid)') is not null as media_guard_exists,
  exists(
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='social_case_files_insert'
      and with_check ilike '%storage.filename(name)%'
      and with_check ilike '%social_can_access_case%'
  ) as case_scoped_upload_policy,
  not exists(
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname ilike '%social_case_files%delete%'
  ) as no_client_delete_policy;
