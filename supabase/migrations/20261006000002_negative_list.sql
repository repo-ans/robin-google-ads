-- PDF task 5: block junk searches, for every account and every campaign.
--
--   universal_negatives      - the FF blocked-words list (one place; the dashboard shows it,
--                              n8n reads it). Themes from Robin: obituaries, jobs, products,
--                              writing, etiquette, free.
--   v_negative_list_status   - per account: is "FF - Funeral universal negatives" there, how
--                              many words, how many search campaigns still lack it.
--   ff_action_context        - new source 'neglist' for Rob's one-click setup (n8n): create the
--                              list if missing, add missing words plus the client's own name and
--                              competitors, attach it to every search campaign.
--   dash_search_terms        - "statement timeout" again on big campaigns: RLS was checked on
--                              every daily row. Now one access check, then the query.
-- The old list name "FF Universal Negatives" (from earlier builds) is still recognised.

-- ---------------------------------------------------------------------------
-- universal_negatives
-- ---------------------------------------------------------------------------
create table public.universal_negatives (
  text        text primary key check (text = lower(text) and length(text) between 1 and 80),
  match_type  text not null check (match_type in ('BROAD', 'PHRASE', 'EXACT')),
  theme       text not null,
  created_at  timestamptz not null default now()
);
alter table public.universal_negatives enable row level security;
create policy universal_negatives_select on public.universal_negatives
  for select to authenticated using ((select app.is_agency()));
revoke all on public.universal_negatives from anon, authenticated;
grant select on public.universal_negatives to authenticated;
grant all on public.universal_negatives to service_role;

insert into public.universal_negatives (text, match_type, theme) values
  ('obituary', 'BROAD', 'obituaries'),
  ('obituaries', 'BROAD', 'obituaries'),
  ('obits', 'BROAD', 'obituaries'),
  ('condolences', 'BROAD', 'obituaries'),
  ('service times', 'PHRASE', 'obituaries'),
  ('death notice', 'PHRASE', 'obituaries'),
  ('death notices', 'PHRASE', 'obituaries'),
  ('guestbook', 'BROAD', 'obituaries'),
  ('tribute wall', 'PHRASE', 'obituaries'),
  ('careers', 'BROAD', 'jobs'),
  ('jobs', 'BROAD', 'jobs'),
  ('job', 'BROAD', 'jobs'),
  ('salary', 'BROAD', 'jobs'),
  ('hiring', 'BROAD', 'jobs'),
  ('internship', 'BROAD', 'jobs'),
  ('mortuary school', 'PHRASE', 'jobs'),
  ('mortuary science', 'PHRASE', 'jobs'),
  ('embalmer training', 'PHRASE', 'jobs'),
  ('funeral director license', 'PHRASE', 'jobs'),
  ('urns', 'BROAD', 'products'),
  ('urn', 'BROAD', 'products'),
  ('jewelry', 'BROAD', 'products'),
  ('flowers', 'BROAD', 'products'),
  ('wreath', 'BROAD', 'products'),
  ('caskets for sale', 'PHRASE', 'products'),
  ('headstones', 'BROAD', 'products'),
  ('keepsake', 'BROAD', 'products'),
  ('poems', 'BROAD', 'writing'),
  ('poem', 'BROAD', 'writing'),
  ('eulogy', 'BROAD', 'writing'),
  ('eulogies', 'BROAD', 'writing'),
  ('quotes', 'BROAD', 'writing'),
  ('readings', 'BROAD', 'writing'),
  ('bible verses', 'PHRASE', 'writing'),
  ('sympathy card', 'PHRASE', 'writing'),
  ('sympathy message', 'PHRASE', 'writing'),
  ('etiquette', 'BROAD', 'etiquette'),
  ('what to wear', 'PHRASE', 'etiquette'),
  ('what to say', 'PHRASE', 'etiquette'),
  ('what to write', 'PHRASE', 'etiquette'),
  ('free', 'BROAD', 'free'),
  ('body donation', 'PHRASE', 'free'),
  ('donate body', 'PHRASE', 'free'),
  ('donate my body', 'PHRASE', 'free')
on conflict (text) do nothing;

-- ---------------------------------------------------------------------------
-- v_negative_list_status (security invoker - RLS applies)
-- ---------------------------------------------------------------------------
create view public.v_negative_list_status with (security_invoker = true) as
with lists as (
  select ss.customer_id, ss.shared_set_id, ss.name
  from public.shared_sets ss
  where ss.removed_at is null and ss.name in ('FF - Funeral universal negatives', 'FF Universal Negatives')
)
select a.customer_id, a.client_id, a.descriptive_name, a.is_test_account, a.last_synced_at,
       (select l.name from lists l where l.customer_id = a.customer_id
         order by (l.name = 'FF - Funeral universal negatives') desc limit 1) as list_name,
       (select count(*) from public.negatives n join lists l
          on l.customer_id = n.customer_id and l.shared_set_id = n.shared_set_id
        where n.customer_id = a.customer_id and n.level = 'shared_list' and n.removed_at is null) as list_words,
       (select count(*) from public.campaigns k
        where k.customer_id = a.customer_id and k.removed_at is null and k.status in ('ENABLED', 'PAUSED')
          and k.channel_type = 'SEARCH') as search_campaigns,
       (select count(*) from public.campaigns k
        where k.customer_id = a.customer_id and k.removed_at is null and k.status in ('ENABLED', 'PAUSED')
          and k.channel_type = 'SEARCH'
          and not exists (select 1 from public.campaign_shared_sets css join lists l
                            on l.customer_id = css.customer_id and l.shared_set_id = css.shared_set_id
                          where css.customer_id = k.customer_id and css.campaign_id = k.campaign_id
                            and css.removed_at is null)) as campaigns_without_list,
       (select count(*) from public.search_term_triage t
        where t.customer_id = a.customer_id and t.decision = 'block') as blocked_in_triage,
       (select count(*) from public.search_term_triage t
        where t.customer_id = a.customer_id and t.decision = 'ask_rob') as waiting_for_rob
from public.ad_accounts a
where not a.is_manager and a.client_id is not null;

grant select on public.v_negative_list_status to authenticated;

-- ---------------------------------------------------------------------------
-- ff_action_context with source 'neglist'
-- ---------------------------------------------------------------------------
create or replace function public.ff_action_context(p_source text, p_source_id uuid, p_customer_id text default null)
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
    union all
    select k.customer_id, k.campaign_id, null::jsonb, 'proposed'
    from public.campaigns k where p_source = 'negatives' and k.id = p_source_id and k.removed_at is null
    union all
    select a.customer_id, null::text, null::jsonb, 'proposed'
    from public.ad_accounts a
    where p_source in ('tracking', 'neglist') and a.client_id = p_source_id and a.customer_id = p_customer_id and not a.is_manager
  )
  select json_build_object(
    'found', s.customer_id is not null,
    'customer_id', s.customer_id, 'campaign_id', s.campaign_id,
    'proposed_action', s.proposed_action, 'action_status', s.action_status,
    'campaign_name', k.name, 'campaign_row_id', k.id, 'campaign_status', k.status,
    'budget_id', k.budget_id, 'budget_micros', k.budget_micros, 'budget_shared', k.budget_shared,
    'login_customer_id', a.login_customer_id, 'is_test_account', a.is_test_account,
    'client_id', a.client_id, 'writes_enabled', coalesce(c.writes_enabled, false),
    'universal_list_id', case when p_source = 'negatives' then (
       select ss.shared_set_id from public.shared_sets ss
       where ss.customer_id = s.customer_id and ss.removed_at is null and ss.name in ('FF - Funeral universal negatives', 'FF Universal Negatives')
       limit 1) end,
    'existing_campaign_negatives', case when p_source = 'negatives' then (
       select coalesce(json_agg(distinct public.term_norm(n.text) || '|' || coalesce(n.match_type, '')), '[]'::json)
       from public.negatives n
       where n.customer_id = s.customer_id and n.level = 'campaign' and n.campaign_id = s.campaign_id
         and n.removed_at is null) end,
    'existing_list_negatives', case when p_source = 'negatives' then (
       select coalesce(json_agg(distinct public.term_norm(n.text) || '|' || coalesce(n.match_type, '')), '[]'::json)
       from public.negatives n
       join public.shared_sets ss on ss.customer_id = n.customer_id and ss.shared_set_id = n.shared_set_id
       where n.customer_id = s.customer_id and n.level = 'shared_list' and n.removed_at is null
         and ss.name in ('FF - Funeral universal negatives', 'FF Universal Negatives')) end,
    'tracking', case when p_source = 'tracking' then json_build_object(
       'client_phone', c.phone,
       -- Fallback when the client has no business phone yet: the number already
       -- on a call asset in the account (the funeral home's own line).
       'asset_phone', (select z.phone_number from public.assets z
          where z.customer_id = s.customer_id and z.field_type = 'CALL' and z.removed_at is null and z.phone_number is not null
          order by (z.level = 'account') desc, z.synced_at desc limit 1),
       'case_value_micros', c.case_value_micros,
       'currency_code', a.currency_code,
       'call_reporting_enabled', coalesce(a.call_reporting_enabled, false),
       'call_conversion_reporting_enabled', coalesce(a.call_conversion_reporting_enabled, false),
       'auto_tagging_enabled', coalesce(a.auto_tagging_enabled, false),
       'last_synced_at', a.last_synced_at,
       'call_actions', (select coalesce(json_agg(json_build_object('id', x.conversion_action_id, 'name', x.name,
            'type', x.type, 'status', x.status, 'seconds', x.phone_call_duration_seconds)), '[]'::json)
          from public.conversion_actions x
          where x.customer_id = s.customer_id and x.removed_at is null and x.type in ('AD_CALL', 'WEBSITE_CALL')),
       'account_call_assets', (select count(*) from public.assets z
          where z.customer_id = s.customer_id and z.level = 'account' and z.field_type = 'CALL'
            and z.removed_at is null and coalesce(z.status, 'ENABLED') = 'ENABLED'),
       -- Enabled search campaigns with no call asset of their own: the account-level
       -- asset is added only when this is above 0 (no second number on campaigns
       -- that already show one).
       'search_campaigns_without_call_asset', (select count(*) from public.campaigns k2
          where k2.customer_id = s.customer_id and k2.removed_at is null and k2.status = 'ENABLED'
            and k2.channel_type = 'SEARCH'
            and not exists (select 1 from public.assets z where z.customer_id = k2.customer_id and z.level = 'campaign'
                              and z.campaign_id = k2.campaign_id and z.field_type = 'CALL' and z.removed_at is null))
     ) end,
    'neglist', case when p_source = 'neglist' then json_build_object(
       'last_synced_at', a.last_synced_at,
       'client_name', c.name,
       'own_brand_terms', c.own_brand_terms,
       'competitor_terms', c.competitor_terms,
       'list_id', (select ss.shared_set_id from public.shared_sets ss
          where ss.customer_id = s.customer_id and ss.removed_at is null and ss.name in ('FF - Funeral universal negatives', 'FF Universal Negatives')
          order by (ss.name = 'FF - Funeral universal negatives') desc limit 1),
       'list_terms', (select coalesce(json_agg(distinct public.term_norm(n.text) || '|' || coalesce(n.match_type, '')), '[]'::json)
          from public.negatives n
          join public.shared_sets ss on ss.customer_id = n.customer_id and ss.shared_set_id = n.shared_set_id
          where n.customer_id = s.customer_id and n.level = 'shared_list' and n.removed_at is null
            and ss.name in ('FF - Funeral universal negatives', 'FF Universal Negatives')),
       'campaigns', (select coalesce(json_agg(json_build_object('id', k3.campaign_id, 'name', k3.name,
            'linked', exists (select 1 from public.campaign_shared_sets css join public.shared_sets ss
                                on ss.customer_id = css.customer_id and ss.shared_set_id = css.shared_set_id
                              where css.customer_id = k3.customer_id and css.campaign_id = k3.campaign_id
                                and css.removed_at is null and ss.removed_at is null and ss.name in ('FF - Funeral universal negatives', 'FF Universal Negatives')))
          order by k3.name), '[]'::json)
          from public.campaigns k3
          where k3.customer_id = s.customer_id and k3.removed_at is null and k3.status in ('ENABLED', 'PAUSED')
            and k3.channel_type = 'SEARCH'),
       'universal', (select coalesce(json_agg(json_build_object('text', u.text, 'match_type', u.match_type) order by u.theme, u.text), '[]'::json)
          from public.universal_negatives u)
     ) end
  )
  from src s
  left join public.campaigns k on k.customer_id = s.customer_id and k.campaign_id = s.campaign_id
  left join public.ad_accounts a on a.customer_id = s.customer_id
  left join public.clients c on c.id = a.client_id
  limit 1
$$;

revoke all on function public.ff_action_context(text, uuid, text) from public, anon, authenticated;
grant execute on function public.ff_action_context(text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- dash_search_terms: security definer with one explicit access check
-- (app.can_read_customer, the same rule RLS uses), so RLS is not re-checked on
-- every daily row. Output unchanged.
-- ---------------------------------------------------------------------------
drop function if exists public.dash_search_terms(text, text, date, date);
create function public.dash_search_terms(p_customer_id text, p_campaign_id text, p_from date, p_to date)
returns table (
  term_hash text, search_term text, name_filtered boolean, ad_group_id text, ad_group_name text,
  keyword_text text, keyword_match_type text, search_term_match_type text, status text,
  impressions bigint, clicks bigint, cost_micros bigint, conversions numeric, conversions_value numeric,
  is_negated boolean, decision text, theme text
)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not app.can_read_customer(p_customer_id) then
    return;
  end if;
  return query
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
      on tr.customer_id = p_customer_id and tr.campaign_id = p_campaign_id and tr.term_hash = t.term_hash;
end;
$$;

revoke all on function public.dash_search_terms(text, text, date, date) from public, anon;
grant execute on function public.dash_search_terms(text, text, date, date) to authenticated;

notify pgrst, 'reload schema';
