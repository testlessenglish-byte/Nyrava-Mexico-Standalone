-- Read-only verification for organization-specific member identity.
select
  o.name as organization_name,
  i.email,
  i.invitee_name as organization_member_name,
  i.invitee_title as organization_member_title,
  i.role as organization_role,
  i.status as invitation_status,
  m.status::text as membership_status
from public.organization_invitations i
join public.organizations o on o.id=i.org_id
left join public.org_memberships m
  on m.org_id=i.org_id and m.user_id=i.accepted_by
where lower(i.email)='testlessenglish@gmail.com'
order by i.invited_at desc;

select
  to_regprocedure('public.get_social_organization_account(uuid)') is not null
    as organization_account_function_exists;
