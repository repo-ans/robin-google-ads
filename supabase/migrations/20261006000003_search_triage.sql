-- PDF task 5, weekly part: "Every week, Claude sorts new searches into keep,
-- block or ask Rob." n8n ff-search-triage (Monday, and "Sort new searches" on the
-- dashboard) reads the candidates here, sorts them (FF blocked words and the
-- client's own/competitor names first, then the AI for the rest, anything unclear
-- to Rob), and saves the decisions in search_term_triage. Decisions only - adding
-- a negative in Google Ads stays Rob's click.
--
-- Candidates: search terms of the last p_days with impressions, per campaign, that
-- have no decision yet, are not name-filtered (those never reach the AI), and are
-- not already excluded by Google. At most 100 per campaign, by cost.

alter table public.search_term_triage
  add column decided_how text check (decided_how in ('person', 'rule', 'ai'));

create or replace function public.ff_triage_candidates(p_days int default 7, p_client_id uuid default null)
returns table (
  customer_id text, campaign_id text, campaign_name text, client_name text, process text,
  towns text[], own_brand_terms text[], competitor_terms text[], terms json
)
language sql stable security definer
set search_path = ''
as $$
  with acct as (
    select a.customer_id, c.name, c.process, c.towns, c.own_brand_terms, c.competitor_terms
    from public.ad_accounts a
    join public.clients c on c.id = a.client_id and c.archived_at is null
    where not a.is_manager and a.sync_enabled and (p_client_id is null or a.client_id = p_client_id)
  ),
  st as (
    select s.customer_id, s.campaign_id, s.term_hash, max(s.search_term) as term,
           sum(s.cost_micros)::bigint as cost_micros, sum(s.clicks)::bigint as clicks, sum(s.conversions) as conversions
    from public.search_term_daily s
    join acct on acct.customer_id = s.customer_id
    where s.date > current_date - greatest(1, least(coalesce(p_days, 7), 30))
      and not s.name_filtered
      and coalesce(s.status, '') <> 'EXCLUDED'
    group by s.customer_id, s.campaign_id, s.term_hash
    having sum(s.impressions) > 0
  ),
  fresh as (
    select st.*, row_number() over (partition by st.customer_id, st.campaign_id order by st.cost_micros desc, st.clicks desc) as rn
    from st
    where not exists (select 1 from public.search_term_triage t
                      where t.customer_id = st.customer_id and t.campaign_id = st.campaign_id and t.term_hash = st.term_hash)
  )
  select f.customer_id, f.campaign_id, k.name, acct.name, acct.process, acct.towns, acct.own_brand_terms, acct.competitor_terms,
         json_agg(json_build_object('term_hash', f.term_hash, 'term', f.term, 'cost_micros', f.cost_micros,
                                    'clicks', f.clicks, 'conversions', f.conversions) order by f.cost_micros desc)
  from fresh f
  join acct on acct.customer_id = f.customer_id
  left join public.campaigns k on k.customer_id = f.customer_id and k.campaign_id = f.campaign_id
  where f.rn <= 100
  group by f.customer_id, f.campaign_id, k.name, acct.name, acct.process, acct.towns, acct.own_brand_terms, acct.competitor_terms
$$;

revoke all on function public.ff_triage_candidates(int, uuid) from public, anon, authenticated;
grant execute on function public.ff_triage_candidates(int, uuid) to service_role;

notify pgrst, 'reload schema';
