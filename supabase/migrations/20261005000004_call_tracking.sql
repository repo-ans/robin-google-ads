-- PDF task 2 (calls 90s+), for every account, now and future - no Google Ads
-- UI steps. The dashboard shows each account's call tracking status from the
-- synced data, and Rob sets up whatever is missing with one click (n8n
-- ff-apply-campaign-action, source "tracking"):
--   - account: call reporting on, call conversion reporting on, auto-tagging on
--   - conversion action "Calls from ads 90s+"     (AD_CALL, 90 seconds, primary)
--   - conversion action "Calls from website 90s+" (WEBSITE_CALL, 90 seconds, primary)
--   - an account-level call asset with the client's business number, so every
--     campaign (also future ones) shows it, counted by "Calls from ads 90s+"
-- No call recording, whisper or phone menu is ever set.

-- The website tag value (AW-.../label) of each conversion action, so the
-- dashboard can show the exact website script for each client.
alter table public.conversion_actions
  add column tag_send_to text check (tag_send_to is null or tag_send_to ~ '^AW-[0-9]+/[A-Za-z0-9_-]+$');

-- ---------------------------------------------------------------------------
-- v_call_tracking: one row per client account (security invoker - RLS applies).
-- ---------------------------------------------------------------------------
create view public.v_call_tracking with (security_invoker = true) as
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
                             and s.campaign_id = k.campaign_id and s.field_type = 'CALL' and s.removed_at is null)) as search_campaigns_without_call_asset
from public.ad_accounts a
where not a.is_manager and a.client_id is not null;

grant select on public.v_call_tracking to authenticated;

-- ---------------------------------------------------------------------------
-- ff_action_context: a third argument for source 'tracking'
-- (p_source_id = client id, p_customer_id = the account to set up).
-- The two-argument calls (chat, message, negatives) keep working.
-- ---------------------------------------------------------------------------
drop function if exists public.ff_action_context(text, uuid);

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
    where p_source = 'tracking' and a.client_id = p_source_id and a.customer_id = p_customer_id and not a.is_manager
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
       where ss.customer_id = s.customer_id and ss.removed_at is null and ss.name = 'FF Universal Negatives'
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
         and ss.name = 'FF Universal Negatives') end,
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
            and z.removed_at is null and coalesce(z.status, 'ENABLED') = 'ENABLED')
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

notify pgrst, 'reload schema';
