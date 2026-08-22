-- Talk to Care Case: case-scoped, permission-first assistant audit and deterministic health checks.

create table if not exists public.social_care_assistant_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  actor_id uuid not null references auth.users(id),
  language text not null default 'es',
  question text not null,
  response jsonb not null,
  retrieval_manifest jsonb not null default '{}'::jsonb,
  health_check boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.social_care_action_proposals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id),
  social_case_id uuid not null references public.social_cases(id),
  assistant_run_id uuid references public.social_care_assistant_runs(id),
  action_type text not null check(action_type in (
    'create_task','add_to_care_plan','request_document','start_risk_reassessment',
    'find_resource','create_referral','schedule_follow_up','supervisor_review',
    'request_legal_review','draft_case_summary','prepare_closure_checklist'
  )),
  preview jsonb not null,
  status text not null default 'proposed' check(status in ('proposed','confirmed','cancelled')),
  proposed_by uuid not null references auth.users(id),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.social_care_assistant_runs enable row level security;
alter table public.social_care_action_proposals enable row level security;

drop policy if exists social_care_assistant_runs_access on public.social_care_assistant_runs;
create policy social_care_assistant_runs_access on public.social_care_assistant_runs for all to authenticated
using (
  actor_id=auth.uid()
  or public.social_can_manage_org(org_id,auth.uid())
)
with check (
  actor_id=auth.uid()
  and public.social_can_access_case(social_case_id,'general_case_record',false,auth.uid())
);

drop policy if exists social_care_action_proposals_access on public.social_care_action_proposals;
create policy social_care_action_proposals_access on public.social_care_action_proposals for all to authenticated
using (
  proposed_by=auth.uid()
  or public.social_can_manage_org(org_id,auth.uid())
)
with check (
  public.social_can_access_case(social_case_id,'general_case_record',true,auth.uid())
  and (proposed_by=auth.uid() or confirmed_by=auth.uid())
);

create index if not exists social_care_assistant_runs_case_idx
  on public.social_care_assistant_runs(social_case_id,created_at desc);
create index if not exists social_care_action_proposals_case_idx
  on public.social_care_action_proposals(social_case_id,status,created_at desc);

comment on table public.social_care_assistant_runs is
'Permission-first Talk to Care Case audit. Retrieval is case/org scoped and excludes restricted record types by default.';
comment on table public.social_care_action_proposals is
'Preview-and-confirm actions. Assistant output alone never mutates material case state.';
