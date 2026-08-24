-- Run after 20260824100000_social_invitation_auto_join.sql.
-- This is read-only verification; it does not alter accounts or invitations.

select
  to_regprocedure('public.activate_existing_social_invitee(uuid)') is not null
    as activate_existing_invitee_exists,
  to_regprocedure('public.accept_matching_social_organization_invitations()') is not null
    as email_match_acceptance_exists,
  to_regprocedure('public.accept_social_organization_invitation(text)') is not null
    as token_acceptance_exists;

select
  o.name as organization_name,
  i.email as invited_email,
  i.status as invitation_status,
  i.accepted_at,
  (m.status='active' and m.deleted_at is null) as active_membership,
  m.role_in_org::text as organization_role,
  coalesce(p.display_name,p.full_name,p.email,i.invitee_name) as member_name,
  i.invitee_title as invited_title
from public.organization_invitations i
join public.organizations o on o.id=i.org_id
left join public.org_memberships m
  on m.org_id=i.org_id and m.user_id=i.accepted_by
left join public.profiles p on p.id=m.user_id
where lower(i.email) in (
  lower('testlessenglish@gmail.com'),
  lower('h.g4972@gmail.com')
)
order by i.invited_at desc;
