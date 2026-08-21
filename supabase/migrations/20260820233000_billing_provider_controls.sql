-- Independently controllable payment providers. Secrets remain environment-only.
create table if not exists public.billing_provider_settings (
  provider text primary key check (provider in ('mercadopago','stripe')),
  enabled boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.billing_provider_settings enable row level security;
revoke all on public.billing_provider_settings from anon, authenticated;

insert into public.billing_provider_settings(provider,enabled)
values ('mercadopago',true),('stripe',false)
on conflict(provider) do nothing;

create or replace function public.prevent_disabling_all_billing_providers()
returns trigger language plpgsql as $$
begin
  if new.enabled=false and not exists(
    select 1 from public.billing_provider_settings
    where provider<>new.provider and enabled
  ) then raise exception 'At least one billing provider must remain enabled'; end if;
  new.updated_at:=now();
  return new;
end $$;
drop trigger if exists billing_provider_keep_one_enabled on public.billing_provider_settings;
create trigger billing_provider_keep_one_enabled before update on public.billing_provider_settings
for each row execute function public.prevent_disabling_all_billing_providers();

create table if not exists public.billing_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('mercadopago','stripe')),
  enabled boolean not null,
  actor_id uuid references auth.users(id),
  occurred_at timestamptz not null default now()
);
alter table public.billing_provider_events enable row level security;
revoke all on public.billing_provider_events from anon, authenticated;

create or replace function public.audit_billing_provider_toggle()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.enabled is distinct from old.enabled then
    insert into public.billing_provider_events(provider,enabled,actor_id)
    values(new.provider,new.enabled,auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists billing_provider_toggle_audit on public.billing_provider_settings;
create trigger billing_provider_toggle_audit after update on public.billing_provider_settings
for each row execute function public.audit_billing_provider_toggle();
