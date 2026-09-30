-- App layer: campaign builder table, client settings for keyword research,
-- dashboard read functions (RLS applies) and n8n context functions
-- (service role only).

-- ---------------------------------------------------------------------------
-- Client settings used by ff-build-campaign and ff-dataforseo
-- ---------------------------------------------------------------------------
alter table public.clients
  add column dataforseo_location_code int not null default 2840,   -- 2840 = United States, 2124 = Canada
  add column language_code text not null default 'en',
  -- Campaign C (preplanning) runs in office hours only.
  add column office_hours jsonb not null default
    '{"days":["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"],"start_hour":9,"end_hour":17}';

-- A proposed action in an AI draft has its own status, like chat messages,
-- so it can be applied (by rob_admin) at most once.
alter table public.message_drafts
  add column action_status text check (action_status in ('proposed', 'applied', 'dismissed'));

-- ---------------------------------------------------------------------------
-- campaign_builds: a campaign FF staff drafts and Rob builds (always PAUSED).
-- Written only by ff-build-campaign. Agency-only.
-- ---------------------------------------------------------------------------
create table public.campaign_builds (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  customer_id         text not null references public.ad_accounts(customer_id),
  template            text not null check (template in ('A', 'C')),   -- A at-need 24/7, C preplanning office hours
  name                text not null,
  daily_budget_micros bigint not null check (daily_budget_micros > 0),
  bidding_strategy    text not null default 'MAXIMIZE_CONVERSIONS'
                        check (bidding_strategy in ('MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CLICKS', 'MANUAL_CPC')),
  -- [{ "resource_name": "geoTargetConstants/1023191", "name": "Mount Pleasant, SC" }]
  geo_targets         jsonb not null default '[]',
  -- [{ "name", "final_url", "keywords": [{ "text", "match_type" }],
  --    "ads": [{ "headlines": [..], "descriptions": [..], "path1", "path2" }] }]
  ad_groups           jsonb not null default '[]',
  status              text not null default 'draft' check (status in ('draft', 'building', 'built', 'error')),
  resources           jsonb not null default '{}',
  error               text,
  created_by          uuid references auth.users(id) on delete set null,
  built_by            uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  built_at            timestamptz
);
create index campaign_builds_client_idx on public.campaign_builds(client_id, created_at desc);
create trigger campaign_builds_set_updated_at
  before update on public.campaign_builds
  for each row execute function app.set_updated_at();

alter table public.campaign_builds enable row level security;
create policy campaign_builds_select on public.campaign_builds
  for select to authenticated using ((select app.is_agency()));
revoke insert, update, delete, truncate, references, trigger on public.campaign_builds from authenticated;
revoke all on public.campaign_builds from anon;
grant select on public.campaign_builds to authenticated;
grant all on public.campaign_builds to service_role;

-- ===========================================================================
-- Dashboard read functions. SECURITY INVOKER (the default): they run as the
-- signed-in user, so RLS on every table they read still applies.
-- ===========================================================================

create or replace function public.dash_client_totals(p_from date, p_to date)
returns table (
  client_id uuid, accounts int, campaigns int, impressions bigint, clicks bigint, cost_micros bigint,
  conversions numeric, conversions_value numeric, phone_calls bigint, calls_90s bigint, currency_code text
)
language sql stable
set search_path = ''
as $$
  select c.id,
         (select count(*) from public.ad_accounts a where a.client_id = c.id)::int,
         (select count(*) from public.campaigns k join public.ad_accounts a on a.customer_id = k.customer_id
           where a.client_id = c.id and k.removed_at is null)::int,
         coalesce(sum(d.impressions), 0)::bigint,
         coalesce(sum(d.clicks), 0)::bigint,
         coalesce(sum(d.cost_micros), 0)::bigint,
         coalesce(sum(d.conversions), 0),
         coalesce(sum(d.conversions_value), 0),
         coalesce(sum(d.phone_calls), 0)::bigint,
         (select count(*) from public.calls x join public.ad_accounts a on a.customer_id = x.customer_id
           where a.client_id = c.id and x.is_90s_plus and x.start_at::date between p_from and p_to)::bigint,
         (select min(a.currency_code) from public.ad_accounts a where a.client_id = c.id)
  from public.clients c
  left join public.ad_accounts a on a.client_id = c.id
  left join public.campaign_daily d on d.customer_id = a.customer_id and d.date between p_from and p_to
  where c.archived_at is null
  group by c.id
$$;

create or replace function public.dash_campaign_totals(p_client_id uuid, p_from date, p_to date)
returns table (
  id uuid, customer_id text, campaign_id text, name text, status text, channel_type text,
  bidding_strategy_type text, budget_micros bigint, currency_code text, removed_at timestamptz,
  impressions bigint, clicks bigint, cost_micros bigint, conversions numeric, conversions_value numeric,
  all_conversions numeric, phone_calls bigint, search_impression_share numeric, calls_90s bigint
)
language sql stable
set search_path = ''
as $$
  select k.id, k.customer_id, k.campaign_id, k.name, k.status, k.channel_type, k.bidding_strategy_type,
         k.budget_micros, a.currency_code, k.removed_at,
         coalesce(sum(d.impressions), 0)::bigint, coalesce(sum(d.clicks), 0)::bigint,
         coalesce(sum(d.cost_micros), 0)::bigint, coalesce(sum(d.conversions), 0),
         coalesce(sum(d.conversions_value), 0), coalesce(sum(d.all_conversions), 0),
         coalesce(sum(d.phone_calls), 0)::bigint,
         -- Impression share across days, weighted by eligible impressions.
         sum(d.impressions) filter (where d.search_impression_share > 0)
           / nullif(sum(d.impressions / d.search_impression_share) filter (where d.search_impression_share > 0), 0),
         (select count(*) from public.calls x
           where x.customer_id = k.customer_id and x.campaign_id = k.campaign_id
             and x.is_90s_plus and x.start_at::date between p_from and p_to)::bigint
  from public.campaigns k
  join public.ad_accounts a on a.customer_id = k.customer_id
  left join public.campaign_daily d
    on d.customer_id = k.customer_id and d.campaign_id = k.campaign_id and d.date between p_from and p_to
  where a.client_id = p_client_id
  group by k.id, k.customer_id, k.campaign_id, k.name, k.status, k.channel_type, k.bidding_strategy_type,
           k.budget_micros, a.currency_code, k.removed_at
$$;

create or replace function public.dash_keywords(p_customer_id text, p_campaign_id text, p_from date, p_to date)
returns table (
  ad_group_id text, ad_group_name text, criterion_id text, text text, match_type text, status text,
  quality_score int, qs_creative text, qs_landing_page text, qs_expected_ctr text,
  first_page_cpc_micros bigint, top_of_page_cpc_micros bigint, removed_at timestamptz,
  impressions bigint, clicks bigint, cost_micros bigint, conversions numeric, conversions_value numeric,
  google_volume bigint, dfs_volume bigint, dfs_cpc_micros bigint, dfs_competition text
)
language sql stable
set search_path = ''
as $$
  select k.ad_group_id, g.name, k.criterion_id, k.text, k.match_type, k.status,
         k.quality_score, k.qs_creative, k.qs_landing_page, k.qs_expected_ctr,
         k.first_page_cpc_micros, k.top_of_page_cpc_micros, k.removed_at,
         coalesce(m.impressions, 0), coalesce(m.clicks, 0), coalesce(m.cost_micros, 0),
         coalesce(m.conversions, 0), coalesce(m.conversions_value, 0),
         gv.avg_monthly_searches, dv.avg_monthly_searches, dv.avg_cpc_micros, dv.competition
  from public.keywords k
  left join public.ad_groups g on g.customer_id = k.customer_id and g.ad_group_id = k.ad_group_id
  left join lateral (
    select sum(d.impressions)::bigint as impressions, sum(d.clicks)::bigint as clicks,
           sum(d.cost_micros)::bigint as cost_micros, sum(d.conversions) as conversions,
           sum(d.conversions_value) as conversions_value
    from public.keyword_daily d
    where d.customer_id = k.customer_id and d.ad_group_id = k.ad_group_id
      and d.criterion_id = k.criterion_id and d.date between p_from and p_to
  ) m on true
  left join lateral (
    select v.avg_monthly_searches from public.keyword_volume v
    where v.source = 'google_kp' and v.keyword_norm = public.term_norm(k.text)
    order by v.fetched_month desc limit 1
  ) gv on true
  left join lateral (
    select v.avg_monthly_searches, v.avg_cpc_micros, v.competition from public.keyword_volume v
    where v.source = 'dataforseo' and v.keyword_norm = public.term_norm(k.text)
    order by v.fetched_month desc limit 1
  ) dv on true
  where k.customer_id = p_customer_id and k.campaign_id = p_campaign_id
$$;

create or replace function public.dash_search_terms(p_customer_id text, p_campaign_id text, p_from date, p_to date)
returns table (
  term_hash text, search_term text, name_filtered boolean, ad_group_id text, ad_group_name text,
  keyword_text text, keyword_match_type text, search_term_match_type text, status text,
  impressions bigint, clicks bigint, cost_micros bigint, conversions numeric, conversions_value numeric,
  is_negated boolean, decision text, theme text
)
language sql stable
set search_path = ''
as $$
  with t as (
    select s.term_hash, max(s.search_term) as search_term, bool_or(s.name_filtered) as name_filtered,
           s.ad_group_id, max(s.keyword_text) as keyword_text, max(s.keyword_match_type) as keyword_match_type,
           max(s.search_term_match_type) as search_term_match_type, max(s.status) as status,
           sum(s.impressions)::bigint as impressions, sum(s.clicks)::bigint as clicks,
           sum(s.cost_micros)::bigint as cost_micros, sum(s.conversions) as conversions,
           sum(s.conversions_value) as conversions_value
    from public.search_term_daily s
    where s.customer_id = p_customer_id and s.campaign_id = p_campaign_id
      and s.date between p_from and p_to
    group by s.term_hash, s.ad_group_id
  )
  select t.term_hash, t.search_term, t.name_filtered, t.ad_group_id, g.name, t.keyword_text,
         t.keyword_match_type, t.search_term_match_type, t.status,
         t.impressions, t.clicks, t.cost_micros, t.conversions, t.conversions_value,
         case when t.name_filtered then false
              else public.search_term_is_negated(p_customer_id, p_campaign_id, t.ad_group_id, t.search_term) end,
         tr.decision, tr.theme
  from t
  left join public.ad_groups g on g.customer_id = p_customer_id and g.ad_group_id = t.ad_group_id
  left join public.search_term_triage tr
    on tr.customer_id = p_customer_id and tr.campaign_id = p_campaign_id and tr.term_hash = t.term_hash
$$;

create or replace function public.dash_hourly(p_customer_id text, p_campaign_id text, p_from date, p_to date)
returns table (day_of_week text, hour int, impressions bigint, clicks bigint, cost_micros bigint,
               conversions numeric, phone_calls bigint)
language sql stable
set search_path = ''
as $$
  select h.day_of_week, h.hour::int, sum(h.impressions)::bigint, sum(h.clicks)::bigint,
         sum(h.cost_micros)::bigint, sum(h.conversions), sum(h.phone_calls)::bigint
  from public.hourly_stats h
  where h.customer_id = p_customer_id and h.campaign_id = p_campaign_id and h.date between p_from and p_to
  group by h.day_of_week, h.hour
$$;

create or replace function public.dash_device(p_customer_id text, p_campaign_id text, p_from date, p_to date)
returns table (device text, impressions bigint, clicks bigint, cost_micros bigint,
               conversions numeric, conversions_value numeric)
language sql stable
set search_path = ''
as $$
  select d.device, sum(d.impressions)::bigint, sum(d.clicks)::bigint, sum(d.cost_micros)::bigint,
         sum(d.conversions), sum(d.conversions_value)
  from public.device_daily d
  where d.customer_id = p_customer_id and d.campaign_id = p_campaign_id and d.date between p_from and p_to
  group by d.device
$$;

create or replace function public.dash_geo(p_customer_id text, p_campaign_id text, p_from date, p_to date)
returns table (location_type text, geo_target_constant text, name text, canonical_name text,
               impressions bigint, clicks bigint, cost_micros bigint, conversions numeric)
language sql stable
set search_path = ''
as $$
  select g.location_type, g.geo_target_constant, t.name, t.canonical_name,
         sum(g.impressions)::bigint, sum(g.clicks)::bigint, sum(g.cost_micros)::bigint, sum(g.conversions)
  from public.geo_daily g
  left join public.geo_targets t on t.geo_target_constant = g.geo_target_constant
  where g.customer_id = p_customer_id and g.campaign_id = p_campaign_id and g.date between p_from and p_to
  group by g.location_type, g.geo_target_constant, t.name, t.canonical_name
  order by sum(g.cost_micros) desc
  limit 300
$$;

create or replace function public.dash_ads(p_customer_id text, p_campaign_id text, p_from date, p_to date)
returns table (
  ad_group_id text, ad_group_name text, ad_id text, type text, status text, ad_strength text,
  final_urls text[], path1 text, path2 text, headlines jsonb, descriptions jsonb,
  approval_status text, review_status text, policy_topics jsonb, removed_at timestamptz,
  impressions bigint, clicks bigint, cost_micros bigint, conversions numeric
)
language sql stable
set search_path = ''
as $$
  select a.ad_group_id, g.name, a.ad_id, a.type, a.status, a.ad_strength, a.final_urls, a.path1, a.path2,
         a.headlines, a.descriptions, a.approval_status, a.review_status, a.policy_topics, a.removed_at,
         coalesce(sum(d.impressions), 0)::bigint, coalesce(sum(d.clicks), 0)::bigint,
         coalesce(sum(d.cost_micros), 0)::bigint, coalesce(sum(d.conversions), 0)
  from public.ads a
  left join public.ad_groups g on g.customer_id = a.customer_id and g.ad_group_id = a.ad_group_id
  left join public.ad_daily d on d.customer_id = a.customer_id and d.ad_group_id = a.ad_group_id
    and d.ad_id = a.ad_id and d.date between p_from and p_to
  where a.customer_id = p_customer_id and a.campaign_id = p_campaign_id
  group by a.ad_group_id, g.name, a.ad_id, a.type, a.status, a.ad_strength, a.final_urls, a.path1, a.path2,
           a.headlines, a.descriptions, a.approval_status, a.review_status, a.policy_topics, a.removed_at
$$;

-- Extensions that apply to the campaign: its own, its ad groups', and account-level ones.
create or replace function public.dash_assets(p_customer_id text, p_campaign_id text, p_from date, p_to date)
returns table (
  level text, asset_id text, field_type text, type text, status text, primary_status text, text text,
  description1 text, description2 text, final_url text, phone_number text,
  call_conversion_reporting_state text, removed_at timestamptz,
  impressions bigint, clicks bigint, cost_micros bigint, conversions numeric
)
language sql stable
set search_path = ''
as $$
  select s.level, s.asset_id, s.field_type, s.type, s.status, s.primary_status, s.text,
         s.description1, s.description2, s.final_url, s.phone_number, s.call_conversion_reporting_state,
         s.removed_at,
         coalesce(sum(d.impressions), 0)::bigint, coalesce(sum(d.clicks), 0)::bigint,
         coalesce(sum(d.cost_micros), 0)::bigint, coalesce(sum(d.conversions), 0)
  from public.assets s
  left join public.asset_daily d
    on d.customer_id = s.customer_id and d.level = s.level and d.scope_id = s.scope_id
   and d.asset_id = s.asset_id and d.field_type = s.field_type and d.date between p_from and p_to
  where s.customer_id = p_customer_id
    and (s.level = 'account' or s.campaign_id = p_campaign_id)
  group by s.level, s.asset_id, s.field_type, s.type, s.status, s.primary_status, s.text,
           s.description1, s.description2, s.final_url, s.phone_number, s.call_conversion_reporting_state,
           s.removed_at
$$;

create or replace function public.dash_conversions(p_customer_id text, p_campaign_id text, p_from date, p_to date)
returns table (
  conversion_action_id text, name text, category text, type text, status text, counting_type text,
  primary_for_goal boolean, phone_call_duration_seconds int, last_conversion_date date,
  flag_no_recent_conversions boolean, flag_call_duration_not_90s boolean,
  conversions numeric, conversions_value numeric, all_conversions numeric
)
language sql stable
set search_path = ''
as $$
  select t.conversion_action_id, t.name, t.category, t.type, t.status, t.counting_type, t.primary_for_goal,
         t.phone_call_duration_seconds, t.last_conversion_date,
         t.flag_no_recent_conversions, t.flag_call_duration_not_90s,
         coalesce(sum(d.conversions), 0), coalesce(sum(d.conversions_value), 0), coalesce(sum(d.all_conversions), 0)
  from public.v_tracking_health t
  left join public.conversion_daily d
    on d.customer_id = t.customer_id and d.conversion_action_id = t.conversion_action_id
   and d.campaign_id = p_campaign_id and d.date between p_from and p_to
  where t.customer_id = p_customer_id
  group by t.conversion_action_id, t.name, t.category, t.type, t.status, t.counting_type, t.primary_for_goal,
           t.phone_call_duration_seconds, t.last_conversion_date, t.flag_no_recent_conversions,
           t.flag_call_duration_not_90s
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'dash_client_totals(date,date)', 'dash_campaign_totals(uuid,date,date)',
    'dash_keywords(text,text,date,date)', 'dash_search_terms(text,text,date,date)',
    'dash_hourly(text,text,date,date)', 'dash_device(text,text,date,date)', 'dash_geo(text,text,date,date)',
    'dash_ads(text,text,date,date)', 'dash_assets(text,text,date,date)', 'dash_conversions(text,text,date,date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- ===========================================================================
-- n8n context functions. SECURITY DEFINER, service role only. They return
-- numbers, names of campaigns/ad groups/actions and filtered search terms -
-- never personal data - so their output is safe to put in an AI prompt.
-- ===========================================================================

-- Campaigns worth a proactive AI look after a sync (reference sync-metrics
-- "Suggest"), with the reference's dedupe done here: skip a campaign that has
-- an unresolved proposed action, or any proactive message in the last 24 hours.
create or replace function public.ff_suggestion_candidates(p_sync_run_id uuid)
returns table (
  customer_id text, campaign_id text, campaign_name text, status text, currency_code text,
  budget_micros bigint, last_day date, day_cost_micros bigint, day_clicks bigint, day_conversions numeric,
  cost_30d_micros bigint, clicks_30d bigint, conversions_30d numeric, conv_value_30d numeric,
  search_is_30d numeric, budget_lost_is_30d numeric, recommendations text
)
language sql stable security definer
set search_path = ''
as $$
  select k.customer_id, k.campaign_id, k.name, k.status, a.currency_code, k.budget_micros,
         l.day,
         coalesce(sum(d.cost_micros) filter (where d.date = l.day), 0)::bigint,
         coalesce(sum(d.clicks) filter (where d.date = l.day), 0)::bigint,
         coalesce(sum(d.conversions) filter (where d.date = l.day), 0),
         coalesce(sum(d.cost_micros), 0)::bigint, coalesce(sum(d.clicks), 0)::bigint,
         coalesce(sum(d.conversions), 0), coalesce(sum(d.conversions_value), 0),
         avg(d.search_impression_share), avg(d.search_budget_lost_is),
         (select string_agg(r.type || case when r.est_extra_conversions > 0
                   then ' (est. +' || round(r.est_extra_conversions, 1) || ' conversions)' else '' end, '; ')
            from public.recommendations r
           where r.customer_id = k.customer_id and r.campaign_id = k.campaign_id and r.status = 'open')
  from public.campaigns k
  join public.ad_accounts a on a.customer_id = k.customer_id and a.client_id is not null
  join public.sync_run_accounts sra
    on sra.sync_run_id = p_sync_run_id and sra.customer_id = k.customer_id and sra.status <> 'failed'
  cross join lateral (
    select max(x.date) as day from public.campaign_daily x where x.customer_id = k.customer_id
  ) l
  left join public.campaign_daily d
    on d.customer_id = k.customer_id and d.campaign_id = k.campaign_id and d.date between l.day - 29 and l.day
  where k.status = 'ENABLED' and k.removed_at is null
    and not exists (
      select 1 from public.campaign_chat_messages m
      where m.customer_id = k.customer_id and m.campaign_id = k.campaign_id
        and (m.action_status = 'proposed' or (m.is_proactive and m.created_at > now() - interval '24 hours'))
    )
  group by k.customer_id, k.campaign_id, k.name, k.status, a.currency_code, k.budget_micros, l.day
$$;

-- Everything the Campaign Assistant needs about one campaign.
create or replace function public.ff_chat_context(p_customer_id text, p_campaign_id text)
returns json
language sql stable security definer
set search_path = ''
as $$
  with k as (
    select c.*, a.currency_code, a.client_id from public.campaigns c
    join public.ad_accounts a on a.customer_id = c.customer_id
    where c.customer_id = p_customer_id and c.campaign_id = p_campaign_id
  ),
  last_day as (select max(date) as day from public.campaign_daily where customer_id = p_customer_id)
  select json_build_object(
    'campaign', (select json_build_object(
        'name', k.name, 'status', k.status, 'bidding', k.bidding_strategy_type,
        'daily_budget', round(coalesce(k.budget_micros, 0) / 1e6, 2), 'budget_shared', k.budget_shared,
        'currency', k.currency_code, 'geo_target_type', k.positive_geo_target_type) from k),
    'last_30_days', (select json_build_object(
        'cost', round(coalesce(sum(d.cost_micros), 0) / 1e6, 2), 'clicks', coalesce(sum(d.clicks), 0),
        'impressions', coalesce(sum(d.impressions), 0), 'conversions', round(coalesce(sum(d.conversions), 0), 2),
        'conversion_value', round(coalesce(sum(d.conversions_value), 0), 2),
        'phone_calls', coalesce(sum(d.phone_calls), 0),
        'avg_search_impression_share', round(avg(d.search_impression_share), 3),
        'avg_budget_lost_is', round(avg(d.search_budget_lost_is), 3))
      from public.campaign_daily d, last_day l
      where d.customer_id = p_customer_id and d.campaign_id = p_campaign_id and d.date between l.day - 29 and l.day),
    'last_7_days', (select coalesce(json_agg(json_build_object('date', d.date, 'cost', round(d.cost_micros / 1e6, 2),
        'clicks', d.clicks, 'conversions', round(d.conversions, 2)) order by d.date), '[]'::json)
      from public.campaign_daily d, last_day l
      where d.customer_id = p_customer_id and d.campaign_id = p_campaign_id and d.date between l.day - 6 and l.day),
    'calls_30d', (select json_build_object('total', count(*), 'over_90s', count(*) filter (where x.is_90s_plus))
      from public.calls x, last_day l
      where x.customer_id = p_customer_id and x.campaign_id = p_campaign_id and x.start_at::date > l.day - 30),
    'recommendations', (select coalesce(json_agg(json_build_object('type', r.type,
        'est_extra_conversions', round(r.est_extra_conversions, 1), 'est_extra_clicks', round(r.est_extra_clicks))), '[]'::json)
      from public.recommendations r
      where r.customer_id = p_customer_id and r.campaign_id = p_campaign_id and r.status = 'open'),
    'top_search_terms_30d', (select coalesce(json_agg(t), '[]'::json) from (
        select s.search_term as term, round(sum(s.cost_micros) / 1e6, 2) as cost, sum(s.clicks) as clicks,
               round(sum(s.conversions), 2) as conversions
        from public.search_term_daily s, last_day l
        where s.customer_id = p_customer_id and s.campaign_id = p_campaign_id and s.date > l.day - 30
        group by s.search_term order by sum(s.cost_micros) desc limit 15) t),
    'keywords', (select json_build_object('count', count(*), 'avg_quality_score', round(avg(q.quality_score), 1),
        'low_quality', count(*) filter (where q.quality_score < 5))
      from public.keywords q
      where q.customer_id = p_customer_id and q.campaign_id = p_campaign_id and q.removed_at is null),
    'history', (select coalesce(json_agg(json_build_object('role', h.role, 'content', left(h.content, 1500))
        order by h.created_at), '[]'::json)
      from (select * from public.campaign_chat_messages m
            where m.customer_id = p_customer_id and m.campaign_id = p_campaign_id
            order by m.created_at desc limit 20) h)
  )
$$;

-- Context for drafting a reply to a client suggestion.
create or replace function public.ff_message_context(p_client_id uuid, p_customer_id text, p_campaign_id text)
returns json
language sql stable security definer
set search_path = ''
as $$
  select json_build_object(
    'client', (select c.name from public.clients c where c.id = p_client_id),
    'campaign', case when p_campaign_id is null then null else public.ff_chat_context(p_customer_id, p_campaign_id) end,
    'campaigns', (select coalesce(json_agg(json_build_object('name', k.name, 'status', k.status,
        'daily_budget', round(coalesce(k.budget_micros, 0) / 1e6, 2))), '[]'::json)
      from public.campaigns k join public.ad_accounts a on a.customer_id = k.customer_id
      where a.client_id = p_client_id and k.removed_at is null)
  )
$$;

-- What a Confirm & Apply refers to, read from the database - never from the
-- request body (the reference trusted the browser's copy of the action).
create or replace function public.ff_action_context(p_source text, p_source_id uuid)
returns json
language sql stable security definer
set search_path = ''
as $$
  with src as (
    select m.customer_id, m.campaign_id, m.proposed_action, m.action_status
    from public.campaign_chat_messages m where p_source = 'chat' and m.id = p_source_id
    union all
    select cm.customer_id, cm.campaign_id, d.proposed_action, d.action_status
    from public.message_drafts d join public.client_messages cm on cm.id = d.message_id
    where p_source = 'message' and d.message_id = p_source_id
  )
  select json_build_object(
    'found', s.customer_id is not null,
    'customer_id', s.customer_id, 'campaign_id', s.campaign_id,
    'proposed_action', s.proposed_action, 'action_status', s.action_status,
    'campaign_name', k.name, 'campaign_row_id', k.id, 'campaign_status', k.status,
    'budget_id', k.budget_id, 'budget_micros', k.budget_micros, 'budget_shared', k.budget_shared,
    'login_customer_id', a.login_customer_id, 'is_test_account', a.is_test_account,
    'client_id', a.client_id, 'writes_enabled', coalesce(c.writes_enabled, false)
  )
  from src s
  left join public.campaigns k on k.customer_id = s.customer_id and k.campaign_id = s.campaign_id
  left join public.ad_accounts a on a.customer_id = s.customer_id
  left join public.clients c on c.id = a.client_id
  limit 1
$$;

create or replace function public.ff_build_context(p_build_id uuid)
returns json
language sql stable security definer
set search_path = ''
as $$
  select json_build_object(
    'build', row_to_json(b),
    'account', json_build_object('customer_id', a.customer_id, 'login_customer_id', a.login_customer_id,
       'is_test_account', a.is_test_account, 'currency_code', a.currency_code, 'client_id', a.client_id),
    'client', json_build_object('id', c.id, 'name', c.name, 'website_url', c.website_url,
       'writes_enabled', c.writes_enabled, 'competitor_terms', c.competitor_terms, 'office_hours', c.office_hours,
       'language_code', c.language_code)
  )
  from public.campaign_builds b
  join public.ad_accounts a on a.customer_id = b.customer_id
  join public.clients c on c.id = b.client_id
  where b.id = p_build_id
$$;

-- Read-only audit input for one account (last 90 days of synced data).
create or replace function public.ff_audit_data(p_customer_id text)
returns json
language sql stable security definer
set search_path = ''
as $$
  with a as (select * from public.ad_accounts where customer_id = p_customer_id),
  p as (select coalesce(max(date), current_date - 1) as to_day from public.campaign_daily where customer_id = p_customer_id),
  per as (select to_day - 89 as from_day, to_day from p)
  select json_build_object(
    'period', (select json_build_object('from', from_day, 'to', to_day) from per),
    'account', (select json_build_object('customer_id', a.customer_id, 'name', a.descriptive_name,
       'currency', a.currency_code, 'time_zone', a.time_zone, 'auto_tagging', a.auto_tagging_enabled,
       'call_reporting', a.call_reporting_enabled, 'call_conversion_reporting', a.call_conversion_reporting_enabled,
       'conversion_tracking_status', a.conversion_tracking_status,
       'enhanced_conversions_for_leads', a.enhanced_conversions_for_leads, 'is_test_account', a.is_test_account,
       'last_synced_at', a.last_synced_at) from a),
    'campaigns', (select coalesce(json_agg(x order by x.cost desc), '[]'::json) from (
       select k.name, k.status, k.channel_type, k.bidding_strategy_type as bidding,
              round(coalesce(k.budget_micros, 0) / 1e6, 2) as daily_budget, k.positive_geo_target_type as geo_type,
              k.network_partners, k.network_display,
              round(coalesce(sum(d.cost_micros), 0) / 1e6, 2) as cost, coalesce(sum(d.clicks), 0) as clicks,
              coalesce(sum(d.impressions), 0) as impressions, round(coalesce(sum(d.conversions), 0), 2) as conversions,
              round(avg(d.search_impression_share), 3) as search_is,
              round(avg(d.search_budget_lost_is), 3) as budget_lost_is,
              round(avg(d.search_rank_lost_is), 3) as rank_lost_is,
              (select string_agg(coalesce(g.canonical_name, t.geo_target_constant), '; ')
                 from public.campaign_targets t left join public.geo_targets g on g.geo_target_constant = t.geo_target_constant
                where t.customer_id = k.customer_id and t.campaign_id = k.campaign_id
                  and t.type in ('LOCATION', 'PROXIMITY') and not t.negative and t.removed_at is null) as locations,
              (select count(*) from public.campaign_targets t where t.customer_id = k.customer_id
                  and t.campaign_id = k.campaign_id and t.type = 'AD_SCHEDULE' and t.removed_at is null) as schedule_slots,
              (select count(*) from public.ad_groups g where g.customer_id = k.customer_id
                  and g.campaign_id = k.campaign_id and g.removed_at is null) as ad_groups
       from public.campaigns k
       cross join per
       join public.campaign_daily d
         on d.customer_id = k.customer_id and d.campaign_id = k.campaign_id
        and d.date between per.from_day and per.to_day
       where k.customer_id = p_customer_id and k.removed_at is null
       group by k.customer_id, k.campaign_id, k.name, k.status, k.channel_type, k.bidding_strategy_type,
                k.budget_micros, k.positive_geo_target_type, k.network_partners, k.network_display) x),
    'campaigns_without_spend', (select coalesce(json_agg(json_build_object('name', k.name, 'status', k.status)), '[]'::json)
       from public.campaigns k, per where k.customer_id = p_customer_id and k.removed_at is null
       and not exists (select 1 from public.campaign_daily d where d.customer_id = k.customer_id
         and d.campaign_id = k.campaign_id and d.date between per.from_day and per.to_day and d.cost_micros > 0)),
    'conversion_actions', (select coalesce(json_agg(json_build_object('name', t.name, 'category', t.category,
       'type', t.type, 'status', t.status, 'counting', t.counting_type, 'primary', t.primary_for_goal,
       'call_seconds', t.phone_call_duration_seconds, 'last_conversion', t.last_conversion_date,
       'no_recent', t.flag_no_recent_conversions, 'call_not_90s', t.flag_call_duration_not_90s)), '[]'::json)
       from public.v_tracking_health t where t.customer_id = p_customer_id),
    'keywords', (select json_build_object('count', count(*),
       'by_match_type', (select json_object_agg(mt, n) from (select coalesce(match_type, 'UNKNOWN') mt, count(*) n
          from public.keywords where customer_id = p_customer_id and removed_at is null group by 1) z),
       'avg_quality_score', round(avg(quality_score), 1), 'low_quality', count(*) filter (where quality_score < 5),
       'broad', count(*) filter (where match_type = 'BROAD'))
       from public.keywords where customer_id = p_customer_id and removed_at is null),
    'ad_groups_keyword_counts', (select coalesce(json_agg(json_build_object('ad_group', g.name, 'keywords', n)), '[]'::json)
       from (select g.name, count(k.*) n from public.ad_groups g
             left join public.keywords k on k.customer_id = g.customer_id and k.ad_group_id = g.ad_group_id and k.removed_at is null
             where g.customer_id = p_customer_id and g.removed_at is null group by g.name) g),
    'search_terms_top', (select coalesce(json_agg(t), '[]'::json) from (
       select s.search_term as term, round(sum(s.cost_micros) / 1e6, 2) as cost, sum(s.clicks) as clicks,
              round(sum(s.conversions), 2) as conversions,
              bool_or(public.search_term_is_negated(s.customer_id, s.campaign_id, s.ad_group_id, s.search_term)) as negated
       from public.search_term_daily s, per
       where s.customer_id = p_customer_id and s.date between per.from_day and per.to_day
       group by s.search_term order by sum(s.cost_micros) desc limit 40) t),
    'search_terms_wasted', (select coalesce(json_agg(t), '[]'::json) from (
       select s.search_term as term, round(sum(s.cost_micros) / 1e6, 2) as cost, sum(s.clicks) as clicks
       from public.search_term_daily s, per
       where s.customer_id = p_customer_id and s.date between per.from_day and per.to_day
       group by s.search_term having sum(s.conversions) = 0 and sum(s.cost_micros) > 0
       order by sum(s.cost_micros) desc limit 25) t),
    'search_terms_name_filtered', (select json_build_object('rows', count(*), 'cost', round(coalesce(sum(cost_micros), 0) / 1e6, 2))
       from public.search_term_daily s, per where s.customer_id = p_customer_id and s.name_filtered
       and s.date between per.from_day and per.to_day),
    'negatives', (select json_build_object(
       'campaign_level', count(*) filter (where level = 'campaign'),
       'ad_group_level', count(*) filter (where level = 'ad_group'),
       'shared_list_level', count(*) filter (where level = 'shared_list'))
       from public.negatives where customer_id = p_customer_id and removed_at is null),
    'shared_lists', (select coalesce(json_agg(json_build_object('name', s.name, 'members', s.member_count,
       'campaigns', (select count(*) from public.campaign_shared_sets c where c.customer_id = s.customer_id
          and c.shared_set_id = s.shared_set_id and c.removed_at is null))), '[]'::json)
       from public.shared_sets s where s.customer_id = p_customer_id and s.removed_at is null),
    'ads', (select json_build_object('count', count(*),
       'disapproved', count(*) filter (where approval_status = 'DISAPPROVED'),
       'limited', count(*) filter (where approval_status in ('APPROVED_LIMITED', 'AREA_OF_INTEREST_ONLY')),
       'by_strength', (select json_object_agg(st, n) from (select coalesce(ad_strength, 'UNKNOWN') st, count(*) n
          from public.ads where customer_id = p_customer_id and removed_at is null and status = 'ENABLED' group by 1) z))
       from public.ads where customer_id = p_customer_id and removed_at is null and status = 'ENABLED'),
    'assets', (select coalesce(json_object_agg(field_type, n), '{}'::json) from (select field_type, count(*) n
       from public.assets where customer_id = p_customer_id and removed_at is null group by field_type) z),
    'calls', (select json_build_object('total', count(*), 'over_90s', count(*) filter (where is_90s_plus),
       'missed', count(*) filter (where status = 'MISSED'))
       from public.calls x, per where x.customer_id = p_customer_id and x.start_at::date between per.from_day and per.to_day),
    'geo', (select json_build_object(
       'presence_cost', round(coalesce(sum(cost_micros) filter (where location_type = 'LOCATION_OF_PRESENCE'), 0) / 1e6, 2),
       'interest_cost', round(coalesce(sum(cost_micros) filter (where location_type = 'AREA_OF_INTEREST'), 0) / 1e6, 2))
       from public.geo_daily g, per where g.customer_id = p_customer_id and g.date between per.from_day and per.to_day),
    'recommendations', (select coalesce(json_agg(json_build_object('type', type,
       'est_extra_conversions', round(est_extra_conversions, 1))), '[]'::json)
       from public.recommendations where customer_id = p_customer_id and status = 'open'),
    'changes_30d', (select coalesce(json_object_agg(ct, n), '{}'::json) from (select coalesce(client_type, 'UNKNOWN') ct, count(*) n
       from public.change_events where customer_id = p_customer_id and changed_at > now() - interval '30 days' group by 1) z)
  )
$$;

-- What ff-dataforseo researches per client: our positive keywords, negatives
-- and search terms (name-filtered terms excluded), newest research first.
create or replace function public.ff_keyword_research_targets(p_client_id uuid default null)
returns table (
  client_id uuid, customer_id text, login_customer_id text, location_code int, language_code text,
  keywords text[], seeds text[], geo_targets text[]
)
language sql stable security definer
set search_path = ''
as $$
  with acct as (
    select distinct on (a.client_id) a.client_id, a.customer_id, a.login_customer_id
    from public.ad_accounts a
    join public.clients c on c.id = a.client_id and c.archived_at is null
    where a.sync_enabled and not a.is_manager and (p_client_id is null or a.client_id = p_client_id)
    order by a.client_id, a.last_synced_at desc nulls last
  ),
  kw as (
    select a.client_id, public.term_norm(k.text) as kw, sum(coalesce(d.cost_micros, 0)) as cost
    from acct x
    join public.ad_accounts a on a.client_id = x.client_id
    join public.keywords k on k.customer_id = a.customer_id and k.removed_at is null
    left join public.keyword_daily d on d.customer_id = k.customer_id and d.ad_group_id = k.ad_group_id
      and d.criterion_id = k.criterion_id and d.date > current_date - 90
    group by a.client_id, public.term_norm(k.text)
  ),
  neg as (
    select a.client_id, public.term_norm(n.text) as kw
    from acct x join public.ad_accounts a on a.client_id = x.client_id
    join public.negatives n on n.customer_id = a.customer_id and n.removed_at is null
  ),
  st as (
    select a.client_id, public.term_norm(s.search_term) as kw, sum(s.cost_micros) as cost
    from acct x join public.ad_accounts a on a.client_id = x.client_id
    join public.search_term_daily s on s.customer_id = a.customer_id and not s.name_filtered
      and s.date > current_date - 90
    group by a.client_id, public.term_norm(s.search_term)
  ),
  allkw as (
    select client_id, kw, cost from kw
    union all select client_id, kw, 0 from neg
    union all select client_id, kw, cost from st
  ),
  ranked as (
    select client_id, kw, max(cost) as cost from allkw
    where kw ~ '^[a-z0-9'' &.-]{2,80}$' and array_length(string_to_array(kw, ' '), 1) <= 10
    group by client_id, kw
  )
  select x.client_id, x.customer_id, x.login_customer_id, c.dataforseo_location_code, c.language_code,
         (select array_agg(r.kw order by r.cost desc) from (select * from ranked r2 where r2.client_id = x.client_id
            order by r2.cost desc limit 1000) r),
         (select array_agg(k2.kw) from (select kw from kw k2 where k2.client_id = x.client_id
            order by k2.cost desc limit 5) k2),
         (select array_agg(distinct t.geo_target_constant) from public.campaign_targets t
           join public.ad_accounts a on a.customer_id = t.customer_id
           where a.client_id = x.client_id and t.type = 'LOCATION' and not t.negative and t.removed_at is null
             and t.geo_target_constant is not null)
  from acct x join public.clients c on c.id = x.client_id
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'ff_suggestion_candidates(uuid)', 'ff_chat_context(text,text)', 'ff_message_context(uuid,text,text)',
    'ff_action_context(text,uuid)', 'ff_build_context(uuid)', 'ff_audit_data(text)',
    'ff_keyword_research_targets(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
