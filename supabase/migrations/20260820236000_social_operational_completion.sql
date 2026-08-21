-- Complete operational workflow transitions for Atención Integral.

create or replace function public.assign_social_case_manager(
  p_case uuid,p_user uuid,p_role text default 'case_manager'
) returns void language plpgsql security invoker set search_path=public as $$
declare c public.social_cases%rowtype;
begin
  select * into c from public.social_cases where id=p_case for update;
  if not found or not (
    public.can_manage_org(c.org_id,auth.uid())
    or public.social_has_capability(c.org_id,'case.view_all',auth.uid())
  ) then raise exception 'Case assignment denied'; end if;
  if not public.is_org_member(c.org_id,p_user) then raise exception 'Assignee is not an active organization member'; end if;
  update public.social_case_assignments set active=false,ended_at=now()
    where social_case_id=p_case and assignment_role=p_role and active;
  insert into public.social_case_assignments(org_id,social_case_id,user_id,assignment_role,assigned_by)
  values(c.org_id,c.id,p_user,p_role,auth.uid());
  if p_role='case_manager' then
    update public.social_cases set assigned_case_manager=p_user,updated_at=now() where id=p_case;
  elsif p_role='supervisor' then
    update public.social_cases set supervising_manager=p_user,updated_at=now() where id=p_case;
  end if;
end $$;

create or replace function public.send_social_referral(
  p_referral uuid,p_purpose text,p_shared_fields jsonb,p_expires timestamptz default null
) returns void language plpgsql security invoker set search_path=public as $$
declare r public.social_referrals%rowtype;
begin
  select * into r from public.social_referrals where id=p_referral for update;
  if not found or not public.social_can_access_case(r.social_case_id,'general_case_record',true,auth.uid()) then
    raise exception 'Referral access denied';
  end if;
  if r.consent_id is null then raise exception 'Referral consent is required'; end if;
  if r.receiving_org_id is not null then
    insert into public.social_referral_shared_packets(
      org_id,receiving_org_id,referral_id,consent_id,purpose,shared_fields,expires_at,created_by
    ) values(r.org_id,r.receiving_org_id,r.id,r.consent_id,p_purpose,coalesce(p_shared_fields,'{}'),p_expires,auth.uid());
  elsif not public.social_consent_covers(
    r.consent_id,r.receiving_institution_id::text,p_purpose,
    array(select jsonb_object_keys(coalesce(p_shared_fields,'{}')))
  ) then raise exception 'Consent does not cover this institution referral'; end if;
  update public.social_referrals set status='sent',referral_date=now(),updated_at=now() where id=r.id;
  insert into public.social_referral_updates(org_id,referral_id,status,note,created_by)
  values(r.org_id,r.id,'sent','Referral sent with consent-validated packet',auth.uid());
end $$;

create or replace function public.verify_social_referral_result(
  p_referral uuid,p_result text,p_response text,p_closure_reason text default null
) returns void language plpgsql security invoker set search_path=public as $$
declare r public.social_referrals%rowtype;
begin
  select * into r from public.social_referrals where id=p_referral for update;
  if not found or not public.social_can_access_case(r.social_case_id,'general_case_record',true,auth.uid()) then
    raise exception 'Referral verification denied';
  end if;
  if nullif(btrim(p_result),'') is null then raise exception 'Verified result is required'; end if;
  update public.social_referrals set status='completed',result=p_result,response=p_response,
    closure_reason=p_closure_reason,result_verified_at=now(),result_verified_by=auth.uid(),updated_at=now()
  where id=r.id;
  insert into public.social_referral_updates(org_id,referral_id,status,note,created_by)
  values(r.org_id,r.id,'completed','Result independently verified',auth.uid());
end $$;

create or replace function public.advance_social_transfer(
  p_transfer uuid,p_action text
) returns void language plpgsql security invoker set search_path=public as $$
declare t public.social_case_transfers%rowtype; declare info text[];
begin
  select * into t from public.social_case_transfers where id=p_transfer for update;
  if not found then raise exception 'Transfer not found'; end if;
  if p_action='approve' then
    if t.status<>'pending_approval' or not (
      public.can_manage_org(t.org_id,auth.uid())
      or public.social_has_capability(t.org_id,'transfer.approve',auth.uid())
    ) then raise exception 'Transfer approval denied'; end if;
    update public.social_case_transfers set status='approved' where id=t.id;
  elsif p_action='send' then
    if t.status<>'approved' or not public.social_can_access_case(t.social_case_id,'general_case_record',true,auth.uid()) then
      raise exception 'Transfer send denied';
    end if;
    if t.receiving_org_id is not null then
      info:=array(select jsonb_object_keys(coalesce(t.selected_information,'{}')));
      if t.consent_id is null or not public.social_consent_covers(
        t.consent_id,t.receiving_org_id::text,'case_transfer',info
      ) then raise exception 'External transfer requires matching consent'; end if;
    end if;
    update public.social_case_transfers set status='sent',sent_at=now() where id=t.id;
  elsif p_action='reject' then
    if t.status not in ('pending_approval','approved','sent') then raise exception 'Transfer cannot be rejected now'; end if;
    update public.social_case_transfers set status='rejected' where id=t.id;
  else raise exception 'Invalid transfer action'; end if;
end $$;

-- Receipt runs with elevated table visibility but grants no general case read;
-- every authority check is explicit and the function exposes no row content.
create or replace function public.accept_social_transfer(p_transfer uuid)
returns void language plpgsql security definer set search_path=public as $$
declare t public.social_case_transfers%rowtype;
begin
  select * into t from public.social_case_transfers where id=p_transfer for update;
  if not found or t.status<>'sent' then raise exception 'Transfer is not awaiting receipt'; end if;
  if not (
    t.to_user_id=auth.uid()
    or (t.receiving_org_id is not null and public.can_manage_org(t.receiving_org_id,auth.uid()))
  ) then raise exception 'Transfer receipt denied'; end if;
  update public.social_case_transfers set status='received',received_at=now(),received_by=auth.uid() where id=t.id;
  if t.to_user_id is not null then
    update public.social_case_assignments set active=false,ended_at=now() where social_case_id=t.social_case_id and active;
    insert into public.social_case_assignments(org_id,social_case_id,user_id,assignment_role,assigned_by)
    values(t.org_id,t.social_case_id,t.to_user_id,'case_manager',auth.uid());
    update public.social_cases set assigned_case_manager=t.to_user_id,status='active',transfer_date=now(),updated_at=now() where id=t.social_case_id;
  else
    update public.social_cases set status='transferred',transfer_date=now(),updated_at=now() where id=t.social_case_id;
  end if;
end $$;

create or replace function public.register_social_document(
  p_case uuid,p_person uuid,p_family uuid,p_title text,p_document_type text,
  p_record_type text,p_sensitivity text,p_consent uuid,p_storage_path text,
  p_checksum text,p_mime text,p_size bigint,p_extraction_authorized boolean
) returns uuid language plpgsql security invoker set search_path=public as $$
declare c public.social_cases%rowtype; declare v_id uuid;
begin
  select * into c from public.social_cases where id=p_case;
  if not found or not public.social_can_access_case(p_case,p_record_type,true,auth.uid()) then
    raise exception 'Document registration denied';
  end if;
  if p_storage_path not like c.org_id::text||'/'||c.id::text||'/'||p_record_type||'/%' then
    raise exception 'Document storage path does not match its authorization boundary';
  end if;
  if p_checksum!~'^[a-fA-F0-9]{64}$' then raise exception 'SHA-256 checksum is required'; end if;
  insert into public.social_documents(
    org_id,social_case_id,person_id,family_id,title,document_type,record_type,
    sensitivity,consent_id,current_version,checksum,mime_type,size_bytes,
    storage_path,extraction_authorized,uploaded_by
  ) values(
    c.org_id,c.id,p_person,p_family,p_title,p_document_type,p_record_type,
    p_sensitivity,p_consent,1,lower(p_checksum),p_mime,p_size,p_storage_path,
    p_extraction_authorized,auth.uid()
  ) returning id into v_id;
  insert into public.social_document_versions(
    org_id,document_id,version,checksum,storage_path,mime_type,size_bytes,uploaded_by
  ) values(c.org_id,v_id,1,lower(p_checksum),p_storage_path,p_mime,p_size,auth.uid());
  return v_id;
end $$;

create or replace function public.add_social_document_version(
  p_document uuid,p_storage_path text,p_checksum text,p_mime text,p_size bigint,p_notes text
) returns integer language plpgsql security invoker set search_path=public as $$
declare d public.social_documents%rowtype; declare v integer;
begin
  select * into d from public.social_documents where id=p_document for update;
  if not found or not public.social_can_access_case(d.social_case_id,d.record_type,true,auth.uid()) then
    raise exception 'Document version denied'; end if;
  if p_storage_path not like d.org_id::text||'/'||d.social_case_id::text||'/'||d.record_type||'/%' then
    raise exception 'Document path boundary mismatch'; end if;
  if p_checksum!~'^[a-fA-F0-9]{64}$' then raise exception 'SHA-256 checksum is required'; end if;
  v:=d.current_version+1;
  insert into public.social_document_versions(org_id,document_id,version,checksum,storage_path,mime_type,size_bytes,uploaded_by,notes)
  values(d.org_id,d.id,v,lower(p_checksum),p_storage_path,p_mime,p_size,auth.uid(),p_notes);
  update public.social_documents set current_version=v,checksum=lower(p_checksum),storage_path=p_storage_path,
    mime_type=p_mime,size_bytes=p_size,updated_at=now() where id=d.id;
  return v;
end $$;

create or replace function public.refresh_social_case_alerts(p_case uuid)
returns integer language plpgsql security invoker set search_path=public as $$
declare c public.social_cases%rowtype; declare n integer:=0;
begin
  select * into c from public.social_cases where id=p_case;
  if not found or not public.social_can_access_case(p_case,'general_case_record',false,auth.uid()) then
    raise exception 'Alert access denied'; end if;
  insert into public.social_alerts(org_id,social_case_id,alert_type,severity,title_es,title_en,due_at,assigned_to,metadata)
  select c.org_id,c.id,'overdue_task',case when t.priority='urgent' then 'critical' else 'warning' end,
    'Tarea vencida: '||t.title,'Overdue task: '||t.title,t.due_at,t.assignee_id,jsonb_build_object('task_id',t.id)
  from public.social_tasks t where t.social_case_id=c.id and t.status not in ('done','cancelled')
    and t.due_at<now() and not exists(select 1 from public.social_alerts a where a.alert_type='overdue_task' and a.metadata->>'task_id'=t.id::text and a.resolved_at is null);
  get diagnostics n=row_count;
  insert into public.social_alerts(org_id,social_case_id,alert_type,severity,title_es,title_en,due_at,assigned_to,metadata)
  select c.org_id,c.id,'consent_expiration','warning','Consentimiento próximo a vencer','Consent expiring soon',
    co.expires_at,c.assigned_case_manager,jsonb_build_object('consent_id',co.id)
  from public.social_consents co where (co.person_id=c.person_id or co.family_id=c.family_id)
    and co.status='active' and co.expires_at between now() and now()+interval '30 days'
    and not exists(select 1 from public.social_alerts a where a.alert_type='consent_expiration' and a.metadata->>'consent_id'=co.id::text and a.resolved_at is null);
  return n;
end $$;

revoke all on function public.assign_social_case_manager(uuid,uuid,text) from public;
revoke all on function public.send_social_referral(uuid,text,jsonb,timestamptz) from public;
revoke all on function public.verify_social_referral_result(uuid,text,text,text) from public;
revoke all on function public.advance_social_transfer(uuid,text) from public;
revoke all on function public.accept_social_transfer(uuid) from public;
revoke all on function public.register_social_document(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,bigint,boolean) from public;
revoke all on function public.add_social_document_version(uuid,text,text,text,bigint,text) from public;
revoke all on function public.refresh_social_case_alerts(uuid) from public;
grant execute on function public.assign_social_case_manager(uuid,uuid,text) to authenticated;
grant execute on function public.send_social_referral(uuid,text,jsonb,timestamptz) to authenticated;
grant execute on function public.verify_social_referral_result(uuid,text,text,text) to authenticated;
grant execute on function public.advance_social_transfer(uuid,text) to authenticated;
grant execute on function public.accept_social_transfer(uuid) to authenticated;
grant execute on function public.register_social_document(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,bigint,boolean) to authenticated;
grant execute on function public.add_social_document_version(uuid,text,text,text,bigint,text) to authenticated;
grant execute on function public.refresh_social_case_alerts(uuid) to authenticated;
