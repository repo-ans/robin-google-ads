-- dash_search_terms hit "canceling statement due to statement timeout" on busy
-- campaigns: it called search_term_is_negated() once per term, and each call
-- re-read v_negatives_all (four tables, RLS checked row by row). Now the
-- campaign's negatives are read once, normalised once, and matched against
-- every term in one join. Same columns, same result, same security invoker.

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
  with t as materialized (
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
  ),
  -- Every negative that applies to this campaign (same levels as v_negatives_all).
  neg as materialized (
    select distinct
           case when n.level = 'ad_group' then n.ad_group_id end as ad_group_id,
           upper(coalesce(n.match_type, 'BROAD')) as mt,
           public.term_norm(n.text) as norm
    from public.negatives n
    where n.customer_id = p_customer_id
      and n.removed_at is null
      and (
        (n.level in ('campaign', 'ad_group') and n.campaign_id = p_campaign_id)
        or n.level = 'account'
        or (n.level = 'shared_list' and exists (
              select 1 from public.campaign_shared_sets css
              where css.customer_id = p_customer_id and css.campaign_id = p_campaign_id
                and css.shared_set_id = n.shared_set_id and css.removed_at is null
                and coalesce(css.status, 'ENABLED') = 'ENABLED'))
      )
  ),
  neg2 as materialized (
    select ad_group_id, mt, norm, string_to_array(norm, ' ') as words from neg where norm <> ''
  ),
  tn as (
    select t.term_hash, t.ad_group_id, public.term_norm(t.search_term) as norm
    from t where not t.name_filtered
  ),
  negated as (
    select distinct tn.term_hash, tn.ad_group_id
    from tn
    join neg2 v on (v.ad_group_id is null or v.ad_group_id = tn.ad_group_id)
     and case v.mt
           when 'EXACT' then tn.norm = v.norm
           when 'PHRASE' then position(' ' || v.norm || ' ' in ' ' || tn.norm || ' ') > 0
           else v.words <@ string_to_array(tn.norm, ' ')
         end
  )
  select t.term_hash, t.search_term, t.name_filtered, t.ad_group_id, g.name, t.keyword_text,
         t.keyword_match_type, t.search_term_match_type, t.status,
         t.impressions, t.clicks, t.cost_micros, t.conversions, t.conversions_value,
         (ng.term_hash is not null), tr.decision, tr.theme
  from t
  left join negated ng on ng.term_hash = t.term_hash and ng.ad_group_id = t.ad_group_id
  left join public.ad_groups g on g.customer_id = p_customer_id and g.ad_group_id = t.ad_group_id
  left join public.search_term_triage tr
    on tr.customer_id = p_customer_id and tr.campaign_id = p_campaign_id and tr.term_hash = t.term_hash
$$;

revoke all on function public.dash_search_terms(text, text, date, date) from public, anon;
grant execute on function public.dash_search_terms(text, text, date, date) to authenticated;

notify pgrst, 'reload schema';
