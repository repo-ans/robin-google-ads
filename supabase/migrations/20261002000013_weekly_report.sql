-- Weekly report (PDF task 8) and the GHL / Google Sheet settings it needs.
--
--   weekly_stats    - one row per client per week (Monday start): spend, clicks,
--                     calls 90s+, forms, arrangements, flags. Counts only.
--   tracking_health - weekly snapshot of every conversion action: status, last
--                     recorded date, flags. History for v_tracking_health.
--   ff_weekly_report(week_start, client_id) - the numbers ff-weekly-report
--                     reads (n8n only). n8n adds the GHL lead count, writes both
--                     tables, the client's Google Sheet and the Slack note to Rob.
-- No personal data anywhere: GHL is asked for a count, never for contacts.

-- ---------------------------------------------------------------------------
-- Client settings: the client's Google Sheet (history) - an id, not a secret.
-- The GHL token is the n8n credential "FF GHL"; ghl_location_id already exists.
-- ---------------------------------------------------------------------------
alter table public.clients
  add column google_sheet_id text check (google_sheet_id is null or google_sheet_id ~ '^[A-Za-z0-9_-]{20,100}$');

-- ---------------------------------------------------------------------------
-- weekly_stats
-- ---------------------------------------------------------------------------
create table public.weekly_stats (
  client_id                   uuid not null references public.clients(id) on delete cascade,
  week_start                  date not null check (extract(isodow from week_start) = 1),
  week_end                    date not null,
  currency_code               text,
  cost_micros                 bigint not null default 0,
  impressions                 bigint not null default 0,
  clicks                      bigint not null default 0,
  conversions                 numeric not null default 0,
  cost_per_conversion_micros  bigint,
  calls_90s                   numeric not null default 0,   -- call conversion actions (ad + website calls)
  ad_calls_90s_seen           int not null default 0,       -- Google call details, 90s+ (cross-check)
  forms                       numeric not null default 0,
  arrangements                numeric not null default 0,   -- PURCHASE conversions (online cremation)
  arrangements_value          numeric not null default 0,
  arrangements_started        numeric not null default 0,   -- BEGIN_CHECKOUT conversions
  ghl_google_leads            int,                          -- GHL contacts tagged from Google Ads (null = GHL not set up)
  signed_cases                int,                          -- filled by the monthly case match
  tracking_ok                 boolean not null default true,
  flags                       text[] not null default '{}', -- plain sentences
  changes                     text[] not null default '{}',
  decisions                   text[] not null default '{}', -- what Rob needs to decide
  sheet_written_at            timestamptz,
  synced_at                   timestamptz not null default now(),
  primary key (client_id, week_start)
);

alter table public.weekly_stats enable row level security;
create policy weekly_stats_select on public.weekly_stats
  for select to authenticated
  using ((select app.can_read_client(client_id)));
grant select on public.weekly_stats to authenticated;
grant all on public.weekly_stats to service_role;

-- ---------------------------------------------------------------------------
-- tracking_health (weekly snapshot)
-- ---------------------------------------------------------------------------
create table public.tracking_health (
  customer_id                 text not null references public.ad_accounts(customer_id),
  conversion_action_id        text not null,
  week_start                  date not null check (extract(isodow from week_start) = 1),
  name                        text not null,
  category                    text,
  type                        text,
  status                      text,
  primary_for_goal            boolean,
  phone_call_duration_seconds int,
  last_conversion_date        date,
  conversions_week            numeric not null default 0,
  spend_14d_micros            bigint not null default 0,
  flag_no_recent_conversions  boolean not null default false,
  flag_call_duration_not_90s  boolean not null default false,
  synced_at                   timestamptz not null default now(),
  primary key (customer_id, conversion_action_id, week_start)
);

alter table public.tracking_health enable row level security;
create policy tracking_health_select on public.tracking_health
  for select to authenticated
  using ((select app.can_read_customer(customer_id)));
grant select on public.tracking_health to authenticated;
grant all on public.tracking_health to service_role;

-- ---------------------------------------------------------------------------
-- ff_weekly_report: one row per active client for the week starting
-- p_week_start (a Monday), with the week before for comparison.
-- Active = not archived, has an account, and spent in either week or has an
-- enabled campaign. Calls 90s+ = AD_CALL / WEBSITE_CALL conversions (the
-- action's own duration setting decides 90s); forms = lead form categories.
-- ---------------------------------------------------------------------------
create or replace function public.ff_weekly_report(p_week_start date, p_client_id uuid default null)
returns table (
  client_id uuid, client_name text, process text, currency_code text,
  ghl_location_id text, google_sheet_id text,
  week_start date, week_end date,
  cost_micros bigint, impressions bigint, clicks bigint, conversions numeric,
  calls_90s numeric, ad_calls_90s_seen int, forms numeric,
  arrangements numeric, arrangements_value numeric, arrangements_started numeric,
  prev_cost_micros bigint, prev_clicks bigint, prev_calls_90s numeric, prev_forms numeric, prev_arrangements numeric,
  has_call_action boolean, has_form_action boolean, has_purchase_action boolean,
  ask_rob_terms int, unsorted_terms int, last_synced_at timestamptz,
  account_flags text[], tracking jsonb
)
language sql stable security definer
set search_path = ''
as $$
  with wk as (
    select p_week_start as ws, p_week_start + 6 as we, p_week_start - 7 as pws, p_week_start - 1 as pwe
  ),
  cl as (
    select c.id, c.name, c.process, c.ghl_location_id, c.google_sheet_id, c.currency_code
    from public.clients c
    where c.archived_at is null and (p_client_id is null or c.id = p_client_id)
  ),
  acc as (
    select a.customer_id, a.client_id, a.currency_code, a.last_synced_at,
           a.auto_tagging_enabled, a.call_reporting_enabled
    from public.ad_accounts a join cl on cl.id = a.client_id
    where not a.is_manager and a.sync_enabled
  ),
  camp as (
    select acc.client_id,
           coalesce(sum(d.cost_micros) filter (where d.date between wk.ws and wk.we), 0)::bigint as cost,
           coalesce(sum(d.impressions) filter (where d.date between wk.ws and wk.we), 0)::bigint as impr,
           coalesce(sum(d.clicks) filter (where d.date between wk.ws and wk.we), 0)::bigint as clicks,
           coalesce(sum(d.conversions) filter (where d.date between wk.ws and wk.we), 0) as conv,
           coalesce(sum(d.cost_micros) filter (where d.date between wk.pws and wk.pwe), 0)::bigint as p_cost,
           coalesce(sum(d.clicks) filter (where d.date between wk.pws and wk.pwe), 0)::bigint as p_clicks
    from acc cross join wk
    join public.campaign_daily d on d.customer_id = acc.customer_id and d.date between wk.pws and wk.we
    group by acc.client_id
  ),
  ca as (
    select acc.client_id, x.customer_id, x.conversion_action_id,
           case
             when x.type in ('AD_CALL', 'WEBSITE_CALL') then 'call'
             when x.category = 'PURCHASE' then 'purchase'
             when x.category = 'BEGIN_CHECKOUT' then 'started'
             when x.category in ('SUBMIT_LEAD_FORM', 'BOOK_APPOINTMENT', 'REQUEST_QUOTE', 'CONTACT') then 'form'
           end as kind,
           x.status
    from public.conversion_actions x join acc on acc.customer_id = x.customer_id
    where x.removed_at is null
  ),
  conv as (
    select ca.client_id,
           coalesce(sum(d.all_conversions) filter (where ca.kind = 'call' and d.date between wk.ws and wk.we), 0) as calls,
           coalesce(sum(d.all_conversions) filter (where ca.kind = 'form' and d.date between wk.ws and wk.we), 0) as forms,
           coalesce(sum(d.all_conversions) filter (where ca.kind = 'purchase' and d.date between wk.ws and wk.we), 0) as arr,
           coalesce(sum(d.all_conversions_value) filter (where ca.kind = 'purchase' and d.date between wk.ws and wk.we), 0) as arr_value,
           coalesce(sum(d.all_conversions) filter (where ca.kind = 'started' and d.date between wk.ws and wk.we), 0) as started,
           coalesce(sum(d.all_conversions) filter (where ca.kind = 'call' and d.date between wk.pws and wk.pwe), 0) as p_calls,
           coalesce(sum(d.all_conversions) filter (where ca.kind = 'form' and d.date between wk.pws and wk.pwe), 0) as p_forms,
           coalesce(sum(d.all_conversions) filter (where ca.kind = 'purchase' and d.date between wk.pws and wk.pwe), 0) as p_arr
    from ca cross join wk
    join public.conversion_daily d
      on d.customer_id = ca.customer_id and d.conversion_action_id = ca.conversion_action_id
     and d.date between wk.pws and wk.we
    where ca.kind is not null
    group by ca.client_id
  ),
  kinds as (
    select ca.client_id,
           bool_or(ca.kind = 'call' and ca.status = 'ENABLED') as has_call,
           bool_or(ca.kind = 'form' and ca.status = 'ENABLED') as has_form,
           bool_or(ca.kind = 'purchase' and ca.status = 'ENABLED') as has_purchase
    from ca group by ca.client_id
  ),
  seen as (
    select acc.client_id, count(*)::int as n
    from acc cross join wk
    join public.calls k on k.customer_id = acc.customer_id
    where k.is_90s_plus and k.start_at >= wk.ws and k.start_at < wk.we + 1
    group by acc.client_id
  ),
  terms as (
    select acc.client_id,
           count(*) filter (where tr.decision = 'ask_rob')::int as ask_rob,
           count(*) filter (where tr.decision is null)::int as unsorted
    from acc
    join (
      select s.customer_id, s.campaign_id, s.term_hash, sum(s.cost_micros) as cost
      from public.search_term_daily s cross join wk w2
      where s.date between w2.ws and w2.we and not s.name_filtered
      group by s.customer_id, s.campaign_id, s.term_hash
    ) st on st.customer_id = acc.customer_id and st.cost > 0
    left join public.search_term_triage tr
      on tr.customer_id = st.customer_id and tr.campaign_id = st.campaign_id and tr.term_hash = st.term_hash
    group by acc.client_id
  ),
  enabled as (
    select acc.client_id, count(*) as n
    from acc join public.campaigns c on c.customer_id = acc.customer_id
    where c.status = 'ENABLED' and c.removed_at is null
    group by acc.client_id
  ),
  aflags as (
    select acc.client_id,
           array_remove(array_agg(distinct f), null) as flags,
           max(acc.last_synced_at) as last_synced_at
    from acc
    left join lateral (values
      (case when acc.auto_tagging_enabled is false then 'Auto-tagging is off in account ' || acc.customer_id || ', so forms cannot capture the GCLID.' end),
      (case when acc.call_reporting_enabled is false then 'Call reporting is off in account ' || acc.customer_id || ', so calls of 90s+ are not counted.' end)
    ) v(f) on true
    group by acc.client_id
  ),
  trk as (
    select acc.client_id,
           jsonb_agg(jsonb_build_object(
             'customer_id', t.customer_id, 'conversion_action_id', t.conversion_action_id,
             'name', t.name, 'category', t.category, 'type', t.type, 'status', t.status,
             'primary_for_goal', t.primary_for_goal,
             'phone_call_duration_seconds', t.phone_call_duration_seconds,
             'last_conversion_date', t.last_conversion_date,
             'conversions_week', coalesce((
               select sum(d.all_conversions) from public.conversion_daily d, wk
               where d.customer_id = t.customer_id and d.conversion_action_id = t.conversion_action_id
                 and d.date between wk.ws and wk.we), 0),
             'spend_14d_micros', t.spend_14d_micros,
             'flag_no_recent_conversions', t.flag_no_recent_conversions,
             'flag_call_duration_not_90s', t.flag_call_duration_not_90s
           ) order by t.name) as rows
    from acc join public.v_tracking_health t on t.customer_id = acc.customer_id
    where t.status = 'ENABLED'
    group by acc.client_id
  )
  select cl.id, cl.name, cl.process,
         coalesce((select max(acc.currency_code) from acc where acc.client_id = cl.id), cl.currency_code),
         cl.ghl_location_id, cl.google_sheet_id,
         wk.ws, wk.we,
         coalesce(camp.cost, 0), coalesce(camp.impr, 0), coalesce(camp.clicks, 0), coalesce(camp.conv, 0),
         coalesce(conv.calls, 0), coalesce(seen.n, 0), coalesce(conv.forms, 0),
         coalesce(conv.arr, 0), coalesce(conv.arr_value, 0), coalesce(conv.started, 0),
         coalesce(camp.p_cost, 0), coalesce(camp.p_clicks, 0), coalesce(conv.p_calls, 0), coalesce(conv.p_forms, 0), coalesce(conv.p_arr, 0),
         coalesce(kinds.has_call, false), coalesce(kinds.has_form, false), coalesce(kinds.has_purchase, false),
         coalesce(terms.ask_rob, 0), coalesce(terms.unsorted, 0), aflags.last_synced_at,
         coalesce(aflags.flags, '{}'), coalesce(trk.rows, '[]'::jsonb)
  from cl cross join wk
  join aflags on aflags.client_id = cl.id
  left join camp on camp.client_id = cl.id
  left join conv on conv.client_id = cl.id
  left join kinds on kinds.client_id = cl.id
  left join seen on seen.client_id = cl.id
  left join terms on terms.client_id = cl.id
  left join enabled on enabled.client_id = cl.id
  left join trk on trk.client_id = cl.id
  where coalesce(camp.cost, 0) > 0 or coalesce(camp.p_cost, 0) > 0 or coalesce(enabled.n, 0) > 0
  order by coalesce(camp.cost, 0) desc, cl.name
$$;

revoke all on function public.ff_weekly_report(date, uuid) from public, anon, authenticated;
grant execute on function public.ff_weekly_report(date, uuid) to service_role;
