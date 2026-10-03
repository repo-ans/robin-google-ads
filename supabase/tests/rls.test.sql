-- RLS and privilege tests. Run: node scripts/test-db-local.mjs (local Postgres, no Docker)
-- or: psql "<ff-dev-db-url>" -f supabase/tests/rls.test.sql
--
-- Fixture: clients A and B, account A (1111111111) and account B (2222222222),
-- and exactly one row per account in every table that has customer_id.
-- Users: rob_admin, ff_staff, viewer A, viewer B, disabled viewer A, and a
-- user with no profile.
--
-- Tables are discovered from the catalog, so a new table without RLS, without
-- a fixture row, or with a leaky policy fails this file.

begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ---------------------------------------------------------------------------
-- Fixture (as postgres, RLS bypassed)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'rob@ff.test'),
  ('00000000-0000-0000-0000-00000000000b', 'staff@ff.test'),
  ('00000000-0000-0000-0000-00000000000c', 'viewer-a@client-a.test'),
  ('00000000-0000-0000-0000-00000000000d', 'viewer-b@client-b.test'),
  ('00000000-0000-0000-0000-00000000000e', 'disabled-a@client-a.test'),
  ('00000000-0000-0000-0000-00000000000f', 'noprofile@ff.test');

insert into public.clients (id, name, slug) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Client A Funeral Home', 'client-a'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'Client B Cremation', 'client-b');

insert into public.ad_accounts (customer_id, client_id, descriptive_name) values
  ('1111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Account A'),
  ('2222222222', 'bbbbbbbb-0000-0000-0000-000000000002', 'Account B'),
  ('3333333333', null, 'Unassigned account');

insert into public.profiles (user_id, email, role, client_id, disabled) values
  ('00000000-0000-0000-0000-00000000000a', 'rob@ff.test', 'rob_admin', null, false),
  ('00000000-0000-0000-0000-00000000000b', 'staff@ff.test', 'ff_staff', null, false),
  ('00000000-0000-0000-0000-00000000000c', 'viewer-a@client-a.test', 'client_viewer', 'aaaaaaaa-0000-0000-0000-000000000001', false),
  ('00000000-0000-0000-0000-00000000000d', 'viewer-b@client-b.test', 'client_viewer', 'bbbbbbbb-0000-0000-0000-000000000002', false),
  ('00000000-0000-0000-0000-00000000000e', 'disabled-a@client-a.test', 'client_viewer', 'aaaaaaaa-0000-0000-0000-000000000001', true);

insert into public.sync_runs (id, trigger) values
  ('99999999-0000-0000-0000-000000000001', 'manual');

do $$
declare
  cid text;
  cl uuid;
  h text := repeat('a', 64);
begin
  foreach cid in array array['1111111111', '2222222222'] loop
    cl := case cid when '1111111111' then 'aaaaaaaa-0000-0000-0000-000000000001'::uuid
                   else 'bbbbbbbb-0000-0000-0000-000000000002'::uuid end;

    insert into public.campaigns (customer_id, campaign_id, name, status) values (cid, '10', 'Campaign', 'ENABLED');
    insert into public.campaign_targets (customer_id, campaign_id, criterion_id, type) values (cid, '10', '1', 'LOCATION');
    insert into public.ad_groups (customer_id, ad_group_id, campaign_id, name) values (cid, '20', '10', 'Ad group');
    insert into public.keywords (customer_id, ad_group_id, criterion_id, campaign_id, text) values (cid, '20', '30', '10', 'funeral home');
    insert into public.shared_sets (customer_id, shared_set_id, name) values (cid, '40', 'Universal negatives');
    insert into public.campaign_shared_sets (customer_id, campaign_id, shared_set_id) values (cid, '10', '40');
    insert into public.negatives (customer_id, level, scope_id, criterion_id, shared_set_id, text, match_type)
      values (cid, 'shared_list', '40', '41', '40', 'jobs', 'BROAD');
    insert into public.ads (customer_id, ad_group_id, ad_id, campaign_id) values (cid, '20', '50', '10');
    insert into public.ad_asset_labels (customer_id, ad_group_id, ad_id, asset_id, field_type) values (cid, '20', '50', '60', 'HEADLINE');
    insert into public.assets (customer_id, level, scope_id, asset_id, field_type) values (cid, 'campaign', '10', '61', 'CALL');
    insert into public.conversion_actions (customer_id, conversion_action_id, name, type, status, phone_call_duration_seconds)
      values (cid, '70', 'Calls 90s+', 'AD_CALL', 'ENABLED', 60);
    insert into public.recommendations (resource_name, customer_id, type) values ('customers/' || cid || '/recommendations/1', cid, 'KEYWORD');
    insert into public.campaign_daily (customer_id, campaign_id, date, cost_micros) values (cid, '10', current_date - 1, 5000000);
    insert into public.ad_group_daily (customer_id, ad_group_id, date, campaign_id) values (cid, '20', current_date - 1, '10');
    insert into public.keyword_daily (customer_id, ad_group_id, criterion_id, date, campaign_id) values (cid, '20', '30', current_date - 1, '10');
    insert into public.search_term_daily (customer_id, ad_group_id, term_hash, date, campaign_id, search_term)
      values (cid, '20', h, current_date - 1, '10', 'funeral home jobs');
    insert into public.ad_daily (customer_id, ad_group_id, ad_id, date, campaign_id) values (cid, '20', '50', current_date - 1, '10');
    insert into public.asset_daily (customer_id, level, scope_id, asset_id, field_type, date) values (cid, 'campaign', '10', '61', 'CALL', current_date - 1);
    insert into public.conversion_daily (customer_id, campaign_id, conversion_action_id, date) values (cid, '10', '70', current_date - 1);
    insert into public.hourly_stats (customer_id, campaign_id, date, hour, day_of_week) values (cid, '10', current_date - 1, 9, 'MONDAY');
    insert into public.device_daily (customer_id, campaign_id, date, device) values (cid, '10', current_date - 1, 'MOBILE');
    insert into public.geo_daily (customer_id, campaign_id, date, location_type) values (cid, '10', current_date - 1, 'LOCATION_OF_PRESENCE');
    insert into public.calls (customer_id, call_resource_name, campaign_id, duration_seconds) values (cid, 'customers/' || cid || '/callViews/1', '10', 120);

    -- agency-only tables
    insert into public.change_events (resource_name, customer_id, changed_at) values ('customers/' || cid || '/changeEvents/1', cid, now());
    insert into public.sync_run_accounts (sync_run_id, customer_id, status) values ('99999999-0000-0000-0000-000000000001', cid, 'ok');
    insert into public.search_term_triage (customer_id, campaign_id, term_hash, search_term, decision) values (cid, '10', h, 'funeral home jobs', 'block');
    insert into public.campaign_chat_messages (customer_id, campaign_id, role, content) values (cid, '10', 'user', 'How is spend?');
    insert into public.audits (client_id, customer_id, period_from, period_to, markdown) values (cl, cid, current_date - 90, current_date, '# Audit');
    insert into public.write_log (customer_id, is_test_account, workflow, operation, request, status) values (cid, true, 'test', 'noop', '{}', 'ok');
    insert into public.campaign_builds (client_id, customer_id, template, name, daily_budget_micros) values (cl, cid, 'A', 'Build', 10000000);
    insert into public.tracking_health (customer_id, conversion_action_id, week_start, name)
      values (cid, '70', date_trunc('week', current_date)::date - 7, 'Calls 90s+');
    insert into public.weekly_stats (client_id, week_start, week_end, cost_micros)
      values (cl, date_trunc('week', current_date)::date - 7, date_trunc('week', current_date)::date - 1, 5000000);

    insert into public.client_messages (id, client_id, direction, body)
      values (case cid when '1111111111' then 'cccccccc-0000-0000-0000-00000000000a'::uuid
                       else 'cccccccc-0000-0000-0000-00000000000b'::uuid end, cl, 'inbound', 'Suggestion');
  end loop;

  insert into public.message_drafts (message_id, draft_body) values
    ('cccccccc-0000-0000-0000-00000000000a', 'Draft A'),
    ('cccccccc-0000-0000-0000-00000000000b', 'Draft B');
  insert into public.geo_targets (geo_target_constant, name) values ('geoTargetConstants/1', 'Somewhere');
  insert into public.keyword_volume (source, keyword_norm, fetched_month) values ('google_kp', 'funeral home', date_trunc('month', current_date));
end;
$$;

-- ---------------------------------------------------------------------------
-- Test helpers (schema tests, dropped by the rollback at the end)
-- ---------------------------------------------------------------------------
create schema tests;

create function tests.agency_only_tables() returns text[] language sql immutable as $$
  select array['change_events', 'sync_runs', 'sync_run_accounts', 'search_term_triage',
               'campaign_chat_messages', 'message_drafts', 'audits', 'write_log', 'campaign_builds']
$$;

-- Tables a client_viewer may read through customer_id.
create function tests.customer_tables() returns setof text language sql stable as $$
  select c.table_name::text
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.column_name = 'customer_id'
    and c.table_name not in ('ad_accounts')
    and not (c.table_name = any (tests.agency_only_tables()))
  order by 1
$$;

create function tests.all_tables() returns setof text language sql stable as $$
  select tablename::text from pg_tables where schemaname = 'public' order by 1
$$;

create function tests.distinct_customers(p_table text) returns text language plpgsql as $$
declare r text;
begin
  execute format('select coalesce(string_agg(distinct customer_id, '','' order by customer_id), '''') from public.%I', p_table)
    into r;
  return r;
end;
$$;

create function tests.row_count(p_table text) returns bigint language plpgsql as $$
declare r bigint;
begin
  execute format('select count(*) from public.%I', p_table) into r;
  return r;
end;
$$;

grant usage on schema tests to authenticated, anon;
grant execute on all functions in schema tests to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 1. Every public table has RLS enabled
-- ---------------------------------------------------------------------------
select is(
  (select coalesce(string_agg(relname, ', '), '') from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  '',
  'every public table has RLS enabled');

select is(
  (select coalesce(string_agg(viewname, ', '), '') from pg_views v
     join pg_class c on c.relname = v.viewname
     join pg_namespace n on n.oid = c.relnamespace and n.nspname = v.schemaname
    where v.schemaname = 'public'
      and not coalesce(c.reloptions @> array['security_invoker=true'], false)),
  '',
  'every public view is security_invoker');

-- ---------------------------------------------------------------------------
-- 2. Viewer A sees only account A in every customer table
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);

select is(tests.distinct_customers(t), '1111111111', 'viewer A sees only account A in ' || t)
from tests.customer_tables() t;

select is(tests.row_count(t), 0::bigint, 'viewer A sees nothing in agency-only ' || t)
from unnest(tests.agency_only_tables()) t;

select is((select array_agg(customer_id order by customer_id) from public.ad_accounts),
          array['1111111111'], 'viewer A sees only its own account (not B, not unassigned)');
select is((select array_agg(slug) from public.clients), array['client-a'], 'viewer A sees only client A');
select is((select array_agg(body) from public.client_messages), array['Suggestion'], 'viewer A sees one message thread');
select is((select count(*) from public.client_messages where client_id <> 'aaaaaaaa-0000-0000-0000-000000000001'), 0::bigint,
          'viewer A sees no client B messages');
select is((select array_agg(email) from public.profiles), array['viewer-a@client-a.test'], 'viewer A sees only its own profile');
select is((select array_agg(distinct customer_id) from public.v_tracking_health), array['1111111111'], 'viewer A: v_tracking_health isolated');
select is((select array_agg(distinct customer_id) from public.v_negatives_all), array['1111111111'], 'viewer A: v_negatives_all isolated');
select is((select array_agg(customer_id) from public.v_account_health), array['1111111111'], 'viewer A: v_account_health isolated');
select is(tests.row_count('geo_targets'), 1::bigint, 'viewer A can read the geo lookup');

-- ---------------------------------------------------------------------------
-- 3. Viewer B is the mirror image
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);

select is(tests.distinct_customers(t), '2222222222', 'viewer B sees only account B in ' || t)
from tests.customer_tables() t;

-- ---------------------------------------------------------------------------
-- 4. Agency roles see everything
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);

select is(tests.distinct_customers(t), '1111111111,2222222222', 'ff_staff sees both accounts in ' || t)
from tests.customer_tables() t;
select ok(tests.row_count(t) > 0, 'ff_staff can read agency-only ' || t)
from unnest(tests.agency_only_tables()) t;
select is(tests.row_count('ad_accounts'), 3::bigint, 'ff_staff sees unassigned accounts too');
select is(tests.row_count('profiles'), 5::bigint, 'ff_staff sees all profiles');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select is(tests.distinct_customers('campaigns'), '1111111111,2222222222', 'rob_admin sees both accounts');

-- ---------------------------------------------------------------------------
-- 5. Disabled viewer and a login with no profile see nothing at all
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
select is(tests.row_count(t), 0::bigint, 'disabled viewer sees nothing in ' || t)
from tests.all_tables() t
where t <> 'profiles';
select is(tests.row_count('profiles'), 1::bigint, 'disabled viewer sees only its own profile row');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000f","role":"authenticated"}', true);
select is(tests.row_count(t), 0::bigint, 'no-profile user sees nothing in ' || t)
from tests.all_tables() t;

-- ---------------------------------------------------------------------------
-- 6. No role can write any table from the browser
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select throws_ok(format('insert into public.%I default values', t), '42501', null,
                 'rob_admin cannot insert into ' || t)
from tests.all_tables() t;
select throws_ok(format('delete from public.%I', t), '42501', null,
                 'rob_admin cannot delete from ' || t)
from tests.all_tables() t;
select throws_ok(
  format('update public.%I set %I = %I', t,
         (select column_name from information_schema.columns
           where table_schema = 'public' and table_name = t order by ordinal_position limit 1),
         (select column_name from information_schema.columns
           where table_schema = 'public' and table_name = t order by ordinal_position limit 1)),
  '42501', null, 'rob_admin cannot update ' || t)
from tests.all_tables() t;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select throws_ok(format('delete from public.%I', t), '42501', null,
                 'viewer A cannot delete from ' || t)
from tests.all_tables() t;

-- ---------------------------------------------------------------------------
-- 7. anon gets nothing
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(format('select 1 from public.%I limit 1', t), '42501', null,
                 'anon cannot read ' || t)
from tests.all_tables() t;

-- ---------------------------------------------------------------------------
-- 8. Reassigning an account moves visibility on the next query
-- ---------------------------------------------------------------------------
reset role;
update public.ad_accounts set client_id = 'bbbbbbbb-0000-0000-0000-000000000002' where customer_id = '1111111111';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is(tests.row_count('campaigns'), 0::bigint, 'after reassignment viewer A sees no campaigns');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select is(tests.distinct_customers('campaigns'), '1111111111,2222222222', 'after reassignment viewer B sees both accounts');

-- ---------------------------------------------------------------------------
-- 9. Match helpers
-- ---------------------------------------------------------------------------
reset role;
select ok(public.negative_matches('funeral home jobs near me', 'jobs', 'BROAD'), 'broad negative matches a word');
select ok(public.negative_matches('mortuary school cost', 'mortuary school', 'PHRASE'), 'phrase negative matches in order');
select ok(not public.negative_matches('school mortuary', 'mortuary school', 'PHRASE'), 'phrase negative needs the order');
select ok(not public.negative_matches('free cremation quote', 'free', 'EXACT'), 'exact negative needs the whole term');
select ok(public.negative_matches('  Free ', 'free', 'EXACT'), 'exact negative ignores case and spaces');
select ok(public.search_term_is_negated('2222222222', '10', '20', 'funeral home jobs'), 'shared-list negative applies to its campaign');
select ok(not public.search_term_is_negated('2222222222', '10', '20', 'funeral home near me'), 'term without a negative is not negated');

-- ---------------------------------------------------------------------------
-- 10. n8n-only functions: no signed-in role may call them (migrations 7 and 8)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok(format('select * from public.%s', f), '42501', null, 'rob_admin cannot call ' || f)
from unnest(array[
  'ff_missing_geo_targets(1)',
  'ff_sync_alerts(''99999999-0000-0000-0000-000000000001'')',
  'ff_suggestion_candidates(''99999999-0000-0000-0000-000000000001'')',
  'ff_chat_context(''1111111111'', ''10'')',
  'ff_message_context(''aaaaaaaa-0000-0000-0000-000000000001'', null, null)',
  'ff_action_context(''chat'', ''99999999-0000-0000-0000-000000000001'')',
  'ff_build_context(''99999999-0000-0000-0000-000000000001'')',
  'ff_audit_data(''1111111111'')',
  'ff_keyword_research_targets(null)',
  'ff_weekly_report(current_date, null)',
  'ff_google_ads_secrets()',
  'ff_set_google_ads_secrets(''{}''::jsonb, null)'
]) f;
select throws_ok('select * from private.google_ads_secrets', '42501', null, 'rob_admin cannot read private.google_ads_secrets');

-- ---------------------------------------------------------------------------
-- 11. Dashboard functions respect RLS (security invoker)
-- ---------------------------------------------------------------------------
reset role;
update public.ad_accounts set client_id = 'aaaaaaaa-0000-0000-0000-000000000001' where customer_id = '1111111111';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select count(*) from public.dash_campaign_totals('bbbbbbbb-0000-0000-0000-000000000002', current_date - 30, current_date)),
          0::bigint, 'viewer A gets no campaign totals for client B');
select is((select count(*) from public.dash_campaign_totals('aaaaaaaa-0000-0000-0000-000000000001', current_date - 30, current_date)),
          1::bigint, 'viewer A gets its own campaign totals');
select is((select array_agg(client_id) from public.dash_client_totals(current_date - 30, current_date)),
          array['aaaaaaaa-0000-0000-0000-000000000001'::uuid], 'viewer A: dash_client_totals shows only client A');
select is((select count(*) from public.dash_keywords('2222222222', '10', current_date - 30, current_date)),
          0::bigint, 'viewer A gets no keywords for account B');
select is((select count(*) from public.dash_search_terms('2222222222', '10', current_date - 30, current_date)),
          0::bigint, 'viewer A gets no search terms for account B');
select is((select count(*) from public.dash_search_terms('1111111111', '10', current_date - 30, current_date)),
          1::bigint, 'viewer A gets its own search terms');
reset role;

-- ---------------------------------------------------------------------------
-- 11b. Weekly report (migration 13): weekly_stats per client, numbers from
--      ff_weekly_report
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select array_agg(client_id) from public.weekly_stats), array['aaaaaaaa-0000-0000-0000-000000000001'::uuid],
          'viewer A sees only its own weekly_stats');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*) from public.weekly_stats), 2::bigint, 'ff_staff sees every weekly_stats row');
reset role;

insert into public.conversion_actions (customer_id, conversion_action_id, name, type, category, status)
  values ('1111111111', '71', 'Preplanning form', 'WEBPAGE', 'SUBMIT_LEAD_FORM', 'ENABLED');
insert into public.conversion_daily (customer_id, campaign_id, conversion_action_id, date, all_conversions)
  values ('1111111111', '10', '71', date_trunc('week', current_date)::date - 7, 2);
update public.conversion_daily set all_conversions = 3
  where customer_id = '1111111111' and conversion_action_id = '70';
insert into public.campaign_daily (customer_id, campaign_id, date, cost_micros, clicks)
  values ('1111111111', '10', date_trunc('week', current_date)::date - 7, 40000000, 12)
  on conflict (customer_id, campaign_id, date) do update set cost_micros = excluded.cost_micros, clicks = excluded.clicks;
select is((select (cost_micros, clicks, forms, has_call_action, has_form_action)::text
             from public.ff_weekly_report(date_trunc('week', current_date)::date - 7, 'aaaaaaaa-0000-0000-0000-000000000001')),
          '(40000000,12,2,t,t)', 'ff_weekly_report: spend, clicks and forms for the week');
select is((select count(*) from public.ff_weekly_report(date_trunc('week', current_date)::date - 7, null)
             where client_id = 'bbbbbbbb-0000-0000-0000-000000000002'), 1::bigint,
          'ff_weekly_report: a client with an enabled campaign is included');
select throws_ok($$insert into public.weekly_stats (client_id, week_start, week_end)
                   values ('aaaaaaaa-0000-0000-0000-000000000001', '2026-09-29', '2026-10-05')$$,
                 '23514', null, 'weekly_stats week_start must be a Monday');

-- ---------------------------------------------------------------------------
-- 12. Google Ads settings status: agency sees 5 rows and no secret values;
--     a client login sees nothing (migration 9)
-- ---------------------------------------------------------------------------
insert into private.google_ads_secrets (name, value) values
  ('client_secret', 'GOCSPX-test-secret'), ('refresh_token', '1//test-refresh'), ('developer_token', 'devtoken1234');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*) from public.google_ads_connection_status()), 5::bigint, 'ff_staff sees the 5 Google Ads settings');
select is((select count(*) from public.google_ads_connection_status() where hint like '%GOCSPX%' or hint like '%1//%'),
          0::bigint, 'client secret and refresh token are never shown');
select is((select hint from public.google_ads_connection_status() where name = 'developer_token'), '...1234',
          'developer token shows only its last 4 characters');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select count(*) from public.google_ads_connection_status()), 0::bigint, 'a client login sees no Google Ads settings');
reset role;

select * from finish();
rollback;
