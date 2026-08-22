-- Finding 3: billing_plans_public_read — internal billing identifiers exposed to anon
-- Finding 4: demo_case_documents_public_read — demo documents readable anonymously
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------
-- 3. Billing plans: drop the public-role SELECT policy, expose only
--    approved marketing fields through a restricted function.
-- ---------------------------------------------------------------
drop policy if exists plans_public_read on public.billing_plans;
drop policy if exists billing_plans_public_read on public.billing_plans;

revoke all on table public.billing_plans from anon;
revoke all on table public.billing_plans from public;
grant select, insert, update, delete on table public.billing_plans to authenticated;
grant all on table public.billing_plans to service_role;

create or replace function public.list_public_billing_plans()
returns table (
  key text,
  label text,
  tagline text,
  features jsonb,
  price_cents integer,
  currency text,
  "interval" text,
  self_serve boolean,
  contact_url text,
  included_seats integer,
  per_seat_price_cents integer,
  sort_order integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Marketing fields ONLY. Never returns stripe_price_id,
  -- mercadopago_plan_id, internal notes, quotas or limits.
  select p.key, p.label, p.tagline, p.features::jsonb, p.price_cents, p.currency,
         p."interval", p.self_serve, p.contact_url, p.included_seats,
         p.per_seat_price_cents, p.sort_order
  from public.billing_plans p
  where p.active = true
  order by p.sort_order asc
$$;

revoke all on function public.list_public_billing_plans() from public;
grant execute on function public.list_public_billing_plans() to anon, authenticated, service_role;

-- ---------------------------------------------------------------
-- 4. Demo case documents: no anonymous access. The public demo pages
--    read through the backend service role and hand out short-lived
--    signed storage URLs, so nothing user-facing changes.
-- ---------------------------------------------------------------
drop policy if exists "Anyone can view documents of published demo cases" on public.demo_case_documents;

revoke all on table public.demo_case_documents from anon;
revoke all on table public.demo_case_documents from public;
grant select, insert, update, delete on table public.demo_case_documents to authenticated;
grant all on table public.demo_case_documents to service_role;

drop policy if exists demo_case_documents_authenticated_read on public.demo_case_documents;
create policy demo_case_documents_authenticated_read
  on public.demo_case_documents
  for select
  to authenticated
  using (
    exists (
      select 1 from public.demo_cases dc
      where dc.id = demo_case_documents.demo_case_id
        and dc.published = true
    )
  );

-- Storage: demo-cases bucket is private and has no anon policy; make the
-- absence explicit and ensure anon cannot read objects there.
drop policy if exists "Anyone can read demo-cases storage objects" on storage.objects;
drop policy if exists "Public can read demo-cases storage objects" on storage.objects;

-- ---------------------------------------------------------------
-- Entitlements / limits / feature flags: signed-in + backend only.
-- ---------------------------------------------------------------
revoke all on table public.plan_entitlements from anon;
revoke all on table public.plan_entitlements from public;
grant all on table public.plan_entitlements to service_role;

revoke all on table public.feature_flags from anon;
revoke all on table public.feature_flags from public;
grant all on table public.feature_flags to service_role;