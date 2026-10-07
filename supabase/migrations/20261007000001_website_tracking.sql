-- PDF tasks 3 and 7 for every client, without Google Ads UI work, plus the
-- website check.
--
--   ff_action_context    call tracking setup also sees website actions (with category)
--                        and the client's process, so Rob's one click creates
--                        "Preplanning form" (funeral homes) or "Online arrangement paid" +
--                        "Arrangement started" (online cremation) when missing
--   v_call_tracking      + has_form_action, has_purchase_action, has_start_action,
--                        purchase_send_to, start_send_to, process (for the website script)
--   website_checks       what n8n ff-website-check found on each client's public pages
--                        (no login, no personal data): our script, the Google tag, a GHL /
--                        lead form, online checkout, the platform. Latest row per URL.
--   ff_website_targets   the pages to check per client: the website on Edit client plus the
--                        landing pages of enabled ads (n8n only)

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
       'process', c.process,
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
            'type', x.type, 'category', x.category, 'status', x.status, 'seconds', x.phone_call_duration_seconds)), '[]'::json)
          from public.conversion_actions x
          where x.customer_id = s.customer_id and x.removed_at is null
            and x.type in ('AD_CALL', 'WEBSITE_CALL', 'UPLOAD_CLICKS', 'UPLOAD_CALLS', 'WEBPAGE')),
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

create or replace view public.v_call_tracking with (security_invoker = true) as
select a.customer_id, a.client_id, a.descriptive_name, a.is_test_account, a.last_synced_at,
       coalesce(a.call_reporting_enabled, false) as call_reporting_enabled,
       coalesce(a.call_conversion_reporting_enabled, false) as call_conversion_reporting_enabled,
       coalesce(a.auto_tagging_enabled, false) as auto_tagging_enabled,
       exists (select 1 from public.conversion_actions x where x.customer_id = a.customer_id and x.removed_at is null
                 and x.status = 'ENABLED' and x.type = 'AD_CALL' and x.phone_call_duration_seconds = 90) as has_ad_call_90,
       exists (select 1 from public.conversion_actions x where x.customer_id = a.customer_id and x.removed_at is null
                 and x.status = 'ENABLED' and x.type = 'WEBSITE_CALL' and x.phone_call_duration_seconds = 90) as has_website_call_90,
       (select x.tag_send_to from public.conversion_actions x where x.customer_id = a.customer_id and x.removed_at is null
          and x.status = 'ENABLED' and x.type = 'WEBSITE_CALL' and x.phone_call_duration_seconds = 90
        order by x.name limit 1) as website_call_send_to,
       (select x.tag_send_to from public.conversion_actions x where x.customer_id = a.customer_id and x.removed_at is null
          and x.status = 'ENABLED' and x.type = 'WEBPAGE' and x.category = 'SUBMIT_LEAD_FORM'
        order by (x.name ilike 'preplanning%') desc, x.name limit 1) as form_send_to,
       exists (select 1 from public.assets s where s.customer_id = a.customer_id and s.level = 'account'
                 and s.field_type = 'CALL' and s.removed_at is null and coalesce(s.status, 'ENABLED') = 'ENABLED') as has_account_call_asset,
       (select count(*) from public.campaigns k
         where k.customer_id = a.customer_id and k.removed_at is null and k.status = 'ENABLED'
           and k.channel_type = 'SEARCH'
           and not exists (select 1 from public.assets s where s.customer_id = k.customer_id and s.level = 'campaign'
                             and s.campaign_id = k.campaign_id and s.field_type = 'CALL' and s.removed_at is null)) as search_campaigns_without_call_asset,
       exists (select 1 from public.conversion_actions x where x.customer_id = a.customer_id and x.removed_at is null
                 and x.status = 'ENABLED' and x.type = 'UPLOAD_CLICKS'
                 and (x.name ilike 'case signed%' or x.name ilike 'ff - signed case%')) as has_case_signed,
       exists (select 1 from public.conversion_actions x where x.customer_id = a.customer_id and x.removed_at is null
                 and x.status = 'ENABLED' and x.type = 'WEBPAGE' and x.category = 'SUBMIT_LEAD_FORM') as has_form_action,
       exists (select 1 from public.conversion_actions x where x.customer_id = a.customer_id and x.removed_at is null
                 and x.status = 'ENABLED' and x.type = 'WEBPAGE' and x.category = 'PURCHASE') as has_purchase_action,
       exists (select 1 from public.conversion_actions x where x.customer_id = a.customer_id and x.removed_at is null
                 and x.status = 'ENABLED' and x.type = 'WEBPAGE' and x.category = 'BEGIN_CHECKOUT') as has_start_action,
       (select x.tag_send_to from public.conversion_actions x where x.customer_id = a.customer_id and x.removed_at is null
          and x.status = 'ENABLED' and x.type = 'WEBPAGE' and x.category = 'PURCHASE' order by x.name limit 1) as purchase_send_to,
       (select x.tag_send_to from public.conversion_actions x where x.customer_id = a.customer_id and x.removed_at is null
          and x.status = 'ENABLED' and x.type = 'WEBPAGE' and x.category = 'BEGIN_CHECKOUT' order by x.name limit 1) as start_send_to,
       (select c.process from public.clients c where c.id = a.client_id) as process
from public.ad_accounts a
where not a.is_manager and a.client_id is not null;;

grant select on public.v_call_tracking to authenticated;

-- ---------------------------------------------------------------------------
-- website_checks
-- ---------------------------------------------------------------------------
create table public.website_checks (
  client_id      uuid not null references public.clients(id) on delete cascade,
  url            text not null check (url ~ '^https?://' and length(url) <= 500),
  checked_at     timestamptz not null default now(),
  status_code    int,
  error          text,
  platform       text,          -- wordpress, ghl, wix, squarespace, shopify, other
  has_ff_script  boolean not null default false,
  ff_settings    text[] not null default '{}',   -- which data- options our script tag has
  has_gtag       boolean not null default false,
  gtag_ids       text[] not null default '{}',   -- AW-/G-/GTM- ids seen on the page
  has_gtm        boolean not null default false,
  has_ghl_form   boolean not null default false,
  has_form       boolean not null default false,
  has_checkout   boolean not null default false,
  checkout_hint  text,          -- stripe, woocommerce, paypal, square, ghl order form
  phones_seen    int not null default 0,         -- how many phone links (the business line), count only
  primary key (client_id, url)
);
alter table public.website_checks enable row level security;
create policy website_checks_select on public.website_checks
  for select to authenticated using ((select app.can_read_client(client_id)));
revoke all on public.website_checks from anon, authenticated;
grant select on public.website_checks to authenticated;
grant all on public.website_checks to service_role;

create or replace function public.ff_website_targets(p_client_id uuid default null)
returns table (client_id uuid, client_name text, process text, urls text[])
language sql stable security definer
set search_path = ''
as $$
  with c as (
    select c.id, c.name, c.process, c.website_url
    from public.clients c
    where c.archived_at is null and (p_client_id is null or c.id = p_client_id)
  ),
  ad_urls as (
    select a.client_id, u.url, count(*) as n
    from public.ads d
    join public.ad_accounts a on a.customer_id = d.customer_id
    cross join lateral unnest(d.final_urls) as u(url)
    where d.removed_at is null and d.status = 'ENABLED' and u.url ~ '^https?://'
    group by a.client_id, u.url
  ),
  ranked as (
    select client_id, url, row_number() over (partition by client_id order by n desc, url) as rn from ad_urls
  )
  select c.id, c.name, c.process,
         (select array_agg(distinct x.url) from (
            select c.website_url as url where c.website_url ~ '^https?://'
            union all
            select r.url from ranked r where r.client_id = c.id and r.rn <= 3
          ) x)
  from c
  where c.website_url ~ '^https?://' or exists (select 1 from ranked r where r.client_id = c.id)
$$;

revoke all on function public.ff_website_targets(uuid) from public, anon, authenticated;
grant execute on function public.ff_website_targets(uuid) to service_role;

notify pgrst, 'reload schema';
