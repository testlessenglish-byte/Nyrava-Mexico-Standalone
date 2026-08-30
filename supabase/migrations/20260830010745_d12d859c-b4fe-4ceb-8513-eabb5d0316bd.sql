-- Harden public access to community-support campaigns and offers.
do $$
begin
  if to_regclass('public.social_community_campaigns') is not null then
    -- Remove full-row anonymous read access; public pages are served through the
    -- server function which sanitizes rows before returning them.
    drop policy if exists "Public can view published campaigns" on public.social_community_campaigns;
    revoke all on table public.social_community_campaigns from anon;
  end if;

  if to_regclass('public.social_community_support_offers') is not null then
    drop policy if exists "Public can insert support offers" on public.social_community_support_offers;
    execute $p$
      create policy "Public can insert offers for published campaigns"
        on public.social_community_support_offers
        for insert
        to anon, authenticated
        with check (
          exists (
            select 1 from public.social_community_campaigns c
            where c.id = social_community_support_offers.campaign_id
              and c.lifecycle_status = 'published'
          )
        )
    $p$;
    revoke all on table public.social_community_support_offers from anon;
    grant insert on table public.social_community_support_offers to anon;
  end if;
end
$$;

-- Anonymous execution of SECURITY DEFINER routines
revoke all on function public.is_primary_subscriber(uuid) from public, anon;
grant execute on function public.is_primary_subscriber(uuid) to authenticated, service_role;

revoke all on function public.tg_enforce_org_created_by_immutable() from public, anon, authenticated;
