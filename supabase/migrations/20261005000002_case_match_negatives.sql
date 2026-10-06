-- PDF task 6 (monthly case match) and task 5 (block junk searches on live
-- campaigns).
--
--   case_match_runs        - one row per case match run: counts only. The case
--                            list itself is never written to Supabase; n8n
--                            uploads it to Google Ads and forgets it.
--   ff_case_match_context  - what ff-case-match needs (n8n only).
--   ff_action_context      - now also answers for source 'negatives' (adding
--                            negative keywords from the Search Terms tab).

-- ---------------------------------------------------------------------------
-- case_match_runs
-- ---------------------------------------------------------------------------
create table public.case_match_runs (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  customer_id         text not null references public.ad_accounts(customer_id),
  month               date not null check (extract(day from month) = 1),  -- the month the cases were signed
  validate_only       boolean not null,         -- true = check run (nothing sent to Google Ads)
  cases_in            int not null default 0,   -- rows in the uploaded list
  skipped             int not null default 0,   -- no click id, phone or email, or a bad date
  sent_click          int not null default 0,   -- sent as click / enhanced conversions (gclid, email, phone)
  sent_call           int not null default 0,   -- sent as call conversions (phone + call time)
  accepted            int not null default 0,   -- Google Ads accepted (matched or queued for matching)
  rejected            int not null default 0,
  reasons             jsonb not null default '{}'::jsonb,  -- reason -> count, never row data
  value_total         numeric not null default 0,
  currency_code       text,
  status              text not null check (status in ('ok', 'partial', 'failed', 'refused')),
  error               text,
  run_by              uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index case_match_runs_client_idx on public.case_match_runs(client_id, month desc, created_at desc);

alter table public.case_match_runs enable row level security;
create policy case_match_runs_select on public.case_match_runs
  for select to authenticated
  using ((select app.can_read_customer(customer_id)));
revoke all on public.case_match_runs from anon, authenticated;
grant select on public.case_match_runs to authenticated;
grant all on public.case_match_runs to service_role;

-- ---------------------------------------------------------------------------
-- ff_case_match_context: the account, the write gate, the case value, and the
-- two upload conversion actions, found by name ("FF - Signed case" for click /
-- enhanced uploads, "FF - Signed case call" for call uploads) and type.
-- ---------------------------------------------------------------------------
create or replace function public.ff_case_match_context(p_client_id uuid, p_customer_id text)
returns json
language sql stable security definer
set search_path = ''
as $$
  select json_build_object(
    'found', a.customer_id is not null,
    'customer_id', a.customer_id,
    'login_customer_id', a.login_customer_id,
    'is_test_account', a.is_test_account,
    'currency_code', a.currency_code,
    'time_zone', coalesce(a.time_zone, 'UTC'),
    'client_id', c.id,
    'client_name', c.name,
    'writes_enabled', coalesce(c.writes_enabled, false),
    'case_value_micros', c.case_value_micros,
    'click_action', (select json_build_object('id', x.conversion_action_id, 'name', x.name)
       from public.conversion_actions x
       where x.customer_id = a.customer_id and x.removed_at is null and x.status = 'ENABLED'
         and x.type = 'UPLOAD_CLICKS' and x.name ilike 'FF - Signed case%' and x.name not ilike '%call%'
       order by x.name limit 1),
    'call_action', (select json_build_object('id', x.conversion_action_id, 'name', x.name)
       from public.conversion_actions x
       where x.customer_id = a.customer_id and x.removed_at is null and x.status = 'ENABLED'
         and x.type = 'UPLOAD_CALLS' and x.name ilike 'FF - Signed case%'
       order by x.name limit 1),
    'enhanced_conversions_for_leads', coalesce(a.enhanced_conversions_for_leads, false)
  )
  from public.clients c
  left join public.ad_accounts a on a.client_id = c.id and a.customer_id = p_customer_id
  where c.id = p_client_id
$$;

revoke all on function public.ff_case_match_context(uuid, text) from public, anon, authenticated;
grant execute on function public.ff_case_match_context(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- ff_action_context: add source 'negatives' (p_source_id = campaigns.id).
-- Returns the campaign, the write gate, the FF universal negative list of the
-- account (if any), and the negatives already there, so nothing is added twice.
-- ---------------------------------------------------------------------------
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
    union all
    select k.customer_id, k.campaign_id, null::jsonb, 'proposed'
    from public.campaigns k where p_source = 'negatives' and k.id = p_source_id and k.removed_at is null
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
         and ss.name = 'FF Universal Negatives') end
  )
  from src s
  left join public.campaigns k on k.customer_id = s.customer_id and k.campaign_id = s.campaign_id
  left join public.ad_accounts a on a.customer_id = s.customer_id
  left join public.clients c on c.id = a.client_id
  limit 1
$$;

revoke all on function public.ff_action_context(text, uuid) from public, anon, authenticated;
grant execute on function public.ff_action_context(text, uuid) to service_role;

notify pgrst, 'reload schema';
