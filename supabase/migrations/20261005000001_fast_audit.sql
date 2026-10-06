-- "Generate audit" failed: ff_audit_data ran the negative-keyword check once per
-- daily search term row over 90 days, before grouping, and hit the statement
-- timeout. Now it groups first and checks only the 40 top terms. Name-filtered
-- placeholder rows are left out of the term lists (they are counted separately).
-- Same output shape.

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
    -- Top 40 terms first, then the negative check only for those 40 terms and
    -- the campaign/ad group pairs they ran in (was: once per daily row - timeout).
    'search_terms_top', (select coalesce(json_agg(t order by t.cost desc), '[]'::json) from (
       select top.term, top.cost, top.clicks, top.conversions,
              exists (
                select 1 from (
                  select distinct s2.campaign_id, s2.ad_group_id
                  from public.search_term_daily s2, per
                  where s2.customer_id = p_customer_id and s2.search_term = top.term
                    and s2.date between per.from_day and per.to_day
                ) pairs
                where public.search_term_is_negated(p_customer_id, pairs.campaign_id, pairs.ad_group_id, top.term)
              ) as negated
       from (
         select s.search_term as term, round(sum(s.cost_micros) / 1e6, 2) as cost, sum(s.clicks) as clicks,
                round(sum(s.conversions), 2) as conversions
         from public.search_term_daily s, per
         where s.customer_id = p_customer_id and s.date between per.from_day and per.to_day
           and not s.name_filtered
         group by s.search_term order by sum(s.cost_micros) desc limit 40
       ) top) t),
    'search_terms_wasted', (select coalesce(json_agg(t), '[]'::json) from (
       select s.search_term as term, round(sum(s.cost_micros) / 1e6, 2) as cost, sum(s.clicks) as clicks
       from public.search_term_daily s, per
       where s.customer_id = p_customer_id and s.date between per.from_day and per.to_day
         and not s.name_filtered
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

revoke all on function public.ff_audit_data(text) from public, anon, authenticated;
grant execute on function public.ff_audit_data(text) to service_role;

notify pgrst, 'reload schema';
