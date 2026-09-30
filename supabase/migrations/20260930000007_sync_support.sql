-- Support for ff-sync: geo name backlog and sync alerts.
-- Secrets are NOT stored in Supabase: they live in n8n credentials (PLAN.md 3.5).

-- ---------------------------------------------------------------------------
-- Geo target constants seen in targets or geo stats that have no name yet.
-- ff-sync looks them up once and caches them in geo_targets.
-- ---------------------------------------------------------------------------
create or replace function public.ff_missing_geo_targets(p_limit int default 500)
returns table (geo_target_constant text)
language sql stable security definer
set search_path = ''
as $$
  select s.g
  from (
    select distinct geo_target_constant as g from public.campaign_targets
    where geo_target_constant is not null
    union
    select distinct geo_target_constant from public.geo_daily
    where geo_target_constant <> ''
  ) s
  where s.g ~ '^geoTargetConstants/[0-9]+$'
    and not exists (select 1 from public.geo_targets t where t.geo_target_constant = s.g)
  limit greatest(1, least(p_limit, 1000))
$$;

revoke all on function public.ff_missing_geo_targets(int) from public, anon, authenticated;
grant execute on function public.ff_missing_geo_targets(int) to service_role;

-- ---------------------------------------------------------------------------
-- Alerts for the Slack note after a sync (PLAN.md 5.6). Returns nothing when
-- all is well. Detail text: plain hyphens, no emoji, no search terms.
-- ---------------------------------------------------------------------------
create or replace function public.ff_sync_alerts(p_sync_run_id uuid)
returns table (severity text, customer_id text, account_name text, kind text, detail text)
language sql stable security definer
set search_path = ''
as $$
  with accts as (
    select a.customer_id, coalesce(a.descriptive_name, a.customer_id) as account_name,
           coalesce(a.currency_code, '') as cur
    from public.ad_accounts a
    where a.sync_enabled and not a.is_manager
  ),
  latest as (
    select d.customer_id, max(d.date) as day from public.campaign_daily d group by d.customer_id
  ),
  camp_day as (
    select d.customer_id, d.campaign_id, d.date, d.cost_micros, d.impressions
    from public.campaign_daily d
    join latest l on l.customer_id = d.customer_id and d.date between l.day - 14 and l.day
  ),
  spend as (
    select c.customer_id, c.campaign_id, l.day,
           sum(c.cost_micros) filter (where c.date = l.day) as day_cost,
           avg(c.cost_micros) filter (where c.date < l.day) as avg_cost,
           sum(c.impressions) filter (where c.date = l.day) as day_impr
    from camp_day c join latest l on l.customer_id = c.customer_id
    group by c.customer_id, c.campaign_id, l.day
  )
  -- Sync problems in this run
  select case when r.status = 'failed' then 'high' else 'medium' end, r.customer_id, a.account_name,
         'sync_' || r.status,
         'Sync ' || r.status || coalesce(' - ' || left(r.error, 200), '')
  from public.sync_run_accounts r join accts a on a.customer_id = r.customer_id
  where r.sync_run_id = p_sync_run_id and r.status <> 'ok'
  union all
  -- Tracking: spend with no conversions for 14 days
  select 'high', t.customer_id, a.account_name, 'no_recent_conversions',
         'Conversion action "' || t.name || '" has had spend but no conversions for 14+ days (last: '
           || coalesce(t.last_conversion_date::text, 'never') || ')'
  from public.v_tracking_health t join accts a on a.customer_id = t.customer_id
  where t.flag_no_recent_conversions and coalesce(t.primary_for_goal, false)
  union all
  select 'medium', t.customer_id, a.account_name, 'call_duration_not_90s',
         'Call conversion action "' || t.name || '" counts calls of '
           || coalesce(t.phone_call_duration_seconds::text, 'default') || 's, SOP says 90s'
  from public.v_tracking_health t join accts a on a.customer_id = t.customer_id
  where t.flag_call_duration_not_90s
  union all
  select 'medium', h.customer_id, a.account_name, 'account_setting',
         concat_ws('; ',
           case when h.flag_auto_tagging_off then 'auto-tagging is off' end,
           case when h.flag_call_reporting_off then 'call reporting is off' end,
           case when h.campaigns_not_presence_only > 0
                then h.campaigns_not_presence_only || ' enabled campaign(s) target interest, not presence only' end)
  from public.v_account_health h join accts a on a.customer_id = h.customer_id
  where h.flag_auto_tagging_off or h.flag_call_reporting_off or h.campaigns_not_presence_only > 0
  union all
  -- Spend spike: latest day above 1.5x the prior 14-day average (and above 20 units)
  select 'medium', s.customer_id, a.account_name, 'spend_spike',
         'Campaign "' || coalesce(c.name, s.campaign_id) || '" spent ' || round(s.day_cost / 1e6, 2) || ' ' || a.cur
           || ' on ' || s.day || ' vs a 14-day average of ' || round(s.avg_cost / 1e6, 2)
  from spend s
  join accts a on a.customer_id = s.customer_id
  left join public.campaigns c on c.customer_id = s.customer_id and c.campaign_id = s.campaign_id
  where s.avg_cost > 0 and s.day_cost > 1.5 * s.avg_cost and s.day_cost > 20000000
  union all
  -- Enabled campaign with no impressions on the latest day
  select 'medium', c.customer_id, a.account_name, 'no_impressions',
         'Enabled campaign "' || c.name || '" had no impressions on ' || l.day
  from public.campaigns c
  join accts a on a.customer_id = c.customer_id
  join latest l on l.customer_id = c.customer_id
  left join spend s on s.customer_id = c.customer_id and s.campaign_id = c.campaign_id
  where c.status = 'ENABLED' and c.removed_at is null and coalesce(s.day_impr, 0) = 0
  union all
  -- Disapproved ads
  select 'high', ad.customer_id, a.account_name, 'ad_disapproved',
         count(*) || ' enabled ad(s) disapproved'
  from public.ads ad join accts a on a.customer_id = ad.customer_id
  where ad.removed_at is null and ad.status = 'ENABLED' and ad.approval_status = 'DISAPPROVED'
  group by ad.customer_id, a.account_name
$$;

revoke all on function public.ff_sync_alerts(uuid) from public, anon, authenticated;
grant execute on function public.ff_sync_alerts(uuid) to service_role;
