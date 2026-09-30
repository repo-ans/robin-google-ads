-- Read helpers for the dashboard. Every view is security_invoker, so the
-- caller's RLS applies (a plain view would run as its owner and bypass RLS).

-- Normalize a search term or keyword the way the match helpers expect.
create or replace function public.term_norm(p text)
returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select regexp_replace(lower(btrim(coalesce(p, ''))), '\s+', ' ', 'g')
$$;

-- Does a negative keyword block this search term? Google negative semantics:
--   EXACT  - same words, same order, nothing else
--   PHRASE - the negative's words appear in order inside the term
--   BROAD  - every word of the negative appears somewhere in the term
-- Negatives do not match close variants, so plain word comparison is right.
create or replace function public.negative_matches(p_term text, p_negative text, p_match_type text)
returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select case upper(coalesce(p_match_type, 'BROAD'))
    when 'EXACT' then public.term_norm(p_term) = public.term_norm(p_negative)
    when 'PHRASE' then position(
      ' ' || public.term_norm(p_negative) || ' ' in ' ' || public.term_norm(p_term) || ' ') > 0
    else string_to_array(public.term_norm(p_negative), ' ')
         <@ string_to_array(public.term_norm(p_term), ' ')
  end
$$;

-- Every negative that applies to a campaign, from all levels, in one list.
-- Shared-list and account-level negatives are expanded to each campaign they cover.
create view public.v_negatives_all with (security_invoker = true) as
select n.customer_id, n.campaign_id, n.ad_group_id, n.level,
       null::text as list_name, n.criterion_id, n.text, n.match_type
from public.negatives n
where n.level in ('campaign', 'ad_group') and n.removed_at is null
union all
select n.customer_id, css.campaign_id, null, n.level,
       s.name, n.criterion_id, n.text, n.match_type
from public.negatives n
join public.campaign_shared_sets css
  on css.customer_id = n.customer_id and css.shared_set_id = n.shared_set_id
 and css.removed_at is null and coalesce(css.status, 'ENABLED') = 'ENABLED'
join public.shared_sets s
  on s.customer_id = n.customer_id and s.shared_set_id = n.shared_set_id
where n.level = 'shared_list' and n.removed_at is null
union all
select n.customer_id, c.campaign_id, null, n.level,
       null, n.criterion_id, n.text, n.match_type
from public.negatives n
join public.campaigns c on c.customer_id = n.customer_id and c.removed_at is null
where n.level = 'account' and n.removed_at is null;

-- Is this search term already blocked by a negative for its campaign/ad group?
create or replace function public.search_term_is_negated(
  p_customer_id text, p_campaign_id text, p_ad_group_id text, p_term text)
returns boolean
language sql stable
set search_path = ''
as $$
  select exists (
    select 1 from public.v_negatives_all v
    where v.customer_id = p_customer_id
      and v.campaign_id = p_campaign_id
      and (v.ad_group_id is null or v.ad_group_id = p_ad_group_id)
      and public.negative_matches(p_term, v.text, v.match_type)
  )
$$;

-- Tracking health per conversion action (SOP: flag spend with no conversions
-- for 14 days; the calls action should count calls of 90s or more).
create view public.v_tracking_health with (security_invoker = true) as
with conv as (
  select customer_id, conversion_action_id,
         max(date) filter (where all_conversions > 0) as last_conversion_date,
         coalesce(sum(all_conversions) filter (where date >= current_date - 30), 0) as all_conversions_30d
  from public.conversion_daily
  group by customer_id, conversion_action_id
),
spend as (
  select customer_id,
         coalesce(sum(cost_micros) filter (where date >= current_date - 14), 0) as spend_14d_micros
  from public.campaign_daily
  group by customer_id
)
select ca.customer_id, ca.conversion_action_id, ca.name, ca.category, ca.type, ca.status,
       ca.counting_type, ca.primary_for_goal, ca.include_in_conversions,
       ca.phone_call_duration_seconds,
       conv.last_conversion_date,
       coalesce(conv.all_conversions_30d, 0) as all_conversions_30d,
       coalesce(spend.spend_14d_micros, 0) as spend_14d_micros,
       (coalesce(spend.spend_14d_micros, 0) > 0
        and ca.status = 'ENABLED'
        and (conv.last_conversion_date is null or conv.last_conversion_date < current_date - 14)
       ) as flag_no_recent_conversions,
       (ca.type in ('AD_CALL', 'WEBSITE_CALL')
        and ca.phone_call_duration_seconds is distinct from 90
       ) as flag_call_duration_not_90s,
       ca.synced_at
from public.conversion_actions ca
left join conv on conv.customer_id = ca.customer_id and conv.conversion_action_id = ca.conversion_action_id
left join spend on spend.customer_id = ca.customer_id
where ca.removed_at is null;

-- Account-level tracking checks from the SOP.
create view public.v_account_health with (security_invoker = true) as
select a.customer_id, a.client_id, a.descriptive_name,
       a.auto_tagging_enabled, a.call_reporting_enabled, a.call_conversion_reporting_enabled,
       a.conversion_tracking_status, a.last_synced_at,
       (a.auto_tagging_enabled is false) as flag_auto_tagging_off,
       (a.call_reporting_enabled is false) as flag_call_reporting_off,
       (select count(*) from public.campaigns c
         where c.customer_id = a.customer_id and c.removed_at is null
           and c.status = 'ENABLED'
           and c.positive_geo_target_type is distinct from 'PRESENCE') as campaigns_not_presence_only,
       (select count(*) from public.v_tracking_health t
         where t.customer_id = a.customer_id and t.flag_no_recent_conversions) as actions_no_recent_conversions
from public.ad_accounts a;

grant select on public.v_negatives_all, public.v_tracking_health, public.v_account_health to authenticated;
grant execute on function public.term_norm(text), public.negative_matches(text, text, text),
  public.search_term_is_negated(text, text, text, text) to authenticated;
