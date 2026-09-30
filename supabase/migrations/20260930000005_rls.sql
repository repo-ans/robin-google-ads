-- Row Level Security and privileges for every table in public.
--
--   anon           : nothing.
--   authenticated  : SELECT only, filtered by policy. No INSERT/UPDATE/DELETE
--                    policies and those privileges are revoked, so a policy
--                    mistake alone cannot open a write path.
--   service_role   : n8n. Bypasses RLS.
--
-- supabase/tests/rls.test.sql fails if any public table has RLS off.

do $$
declare
  t text;
  -- Google Ads data: visible to agency roles, and to a client_viewer whose
  -- client owns the account (app.can_read_customer).
  customer_tables text[] := array[
    'campaigns', 'campaign_targets', 'ad_groups', 'keywords', 'shared_sets',
    'campaign_shared_sets', 'negatives', 'ads', 'ad_asset_labels', 'assets',
    'conversion_actions', 'recommendations',
    'campaign_daily', 'ad_group_daily', 'keyword_daily', 'search_term_daily',
    'ad_daily', 'asset_daily', 'conversion_daily', 'hourly_stats',
    'device_daily', 'geo_daily', 'calls'
  ];
  -- Internal to FF.
  agency_tables text[] := array[
    'change_events', 'sync_runs', 'sync_run_accounts', 'search_term_triage',
    'campaign_chat_messages', 'message_drafts', 'audits', 'write_log'
  ];
  -- Shared lookups, readable by anyone with an active profile.
  lookup_tables text[] := array['geo_targets', 'keyword_volume'];
begin
  foreach t in array customer_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select app.can_read_customer(customer_id)))',
      t || '_select', t);
  end loop;

  foreach t in array agency_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select app.is_agency()))',
      t || '_select', t);
  end loop;

  foreach t in array lookup_tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select app.has_profile()))',
      t || '_select', t);
  end loop;
end;
$$;

alter table public.clients enable row level security;
create policy clients_select on public.clients
  for select to authenticated
  using ((select app.can_read_client(id)));

-- Unassigned accounts (client_id null) are visible to agency roles only.
alter table public.ad_accounts enable row level security;
create policy ad_accounts_select on public.ad_accounts
  for select to authenticated
  using ((select app.can_read_client(client_id)));

alter table public.profiles enable row level security;
create policy profiles_select on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select app.is_agency()));

alter table public.client_messages enable row level security;
create policy client_messages_select on public.client_messages
  for select to authenticated
  using ((select app.can_read_client(client_id)));

-- ---------------------------------------------------------------------------
-- Privileges. RLS decides rows; these decide verbs.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema public from authenticated;
grant select on all tables in schema public to authenticated;

grant all on all tables in schema public to service_role;
grant usage on schema app to service_role;

-- Tables created later by migrations (run as postgres) get the same defaults.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from authenticated;
