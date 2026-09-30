-- FF Google Ads dashboard - core tables, roles and RLS helper functions.
--
-- Trust model (see PLAN.md section 3):
--   - The browser reads with the anon key + the user's JWT. RLS decides what it sees.
--   - The browser never writes business data. n8n writes with the service role key,
--     which bypasses RLS. So `authenticated` gets SELECT policies only.
--   - `anon` gets nothing at all.

create extension if not exists pgcrypto;

create schema if not exists app;

create type public.app_role as enum ('rob_admin', 'ff_staff', 'client_viewer');

create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- clients: one row per FF client (a funeral home or cremation provider).
-- Replaces brief.yaml from the SOP. No personal names in any column.
-- ---------------------------------------------------------------------------
create table public.clients (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  -- Used in audit file names (/audits/<slug>.md) - a business slug, never a person's name.
  slug               text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  website_url        text,
  phone              text,                 -- the business line, not a person's number
  towns              text[] not null default '{}',
  service_area_notes text,
  process            text not null default 'funeral_home'
                       check (process in ('funeral_home', 'online_cremation')),
  case_value_micros  bigint,
  currency_code      text check (currency_code ~ '^[A-Z]{3}$'),
  ghl_location_id    text,
  competitor_terms   text[] not null default '{}',   -- feed the per-client negative list (Phase 6)
  own_brand_terms    text[] not null default '{}',
  slack_channel      text,
  -- Phase 6 gate: live (non-test) accounts refuse writes until rob_admin sets this.
  writes_enabled     boolean not null default false,
  archived_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- ad_accounts: every Google Ads account FF can reach. client_id null means
-- "Unassigned" - discovered under the MCC but not yet given to a client.
-- login_customer_id replaces the reference's DIRECT_ACCESS_CUSTOMER_IDS list:
-- null means the login-customer-id header is omitted (direct access).
-- ---------------------------------------------------------------------------
create table public.ad_accounts (
  customer_id                       text primary key check (customer_id ~ '^[0-9]{10}$'),
  client_id                         uuid references public.clients(id) on delete set null,
  login_customer_id                 text check (login_customer_id ~ '^[0-9]{10}$'),
  descriptive_name                  text,
  currency_code                     text,
  time_zone                         text,
  status                            text,
  is_manager                        boolean not null default false,
  is_test_account                   boolean not null default false,
  manager_path                      text,
  auto_tagging_enabled              boolean,
  call_reporting_enabled            boolean,
  call_conversion_reporting_enabled boolean,
  call_conversion_action            text,
  conversion_tracking_status        text,
  enhanced_conversions_for_leads    boolean,
  sync_enabled                      boolean not null default true,
  first_synced_at                   timestamptz,
  last_synced_at                    timestamptz,
  synced_at                         timestamptz not null default now(),
  created_at                        timestamptz not null default now(),
  updated_at                        timestamptz not null default now()
);

create index ad_accounts_client_id_idx on public.ad_accounts(client_id);

create trigger ad_accounts_set_updated_at
  before update on public.ad_accounts
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles: one row per login. Roles live here; RLS is keyed on it.
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  role       public.app_role not null,
  client_id  uuid references public.clients(id) on delete restrict,
  disabled   boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_viewer_needs_client check (
    (role = 'client_viewer' and client_id is not null)
    or (role <> 'client_viewer' and client_id is null)
  )
);

create index profiles_client_id_idx on public.profiles(client_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Sync bookkeeping. mutate_calls must stay 0 until Phase 6.
-- ---------------------------------------------------------------------------
create table public.sync_runs (
  id              uuid primary key default gen_random_uuid(),
  trigger         text not null check (trigger in ('schedule', 'schedule_weekly', 'manual')),
  requested_by    uuid references auth.users(id) on delete set null,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'running'
                    check (status in ('running', 'ok', 'partial', 'failed')),
  accounts_ok     int not null default 0,
  accounts_failed int not null default 0,
  mutate_calls    int not null default 0
);

create table public.sync_run_accounts (
  sync_run_id uuid not null references public.sync_runs(id) on delete cascade,
  customer_id text not null references public.ad_accounts(customer_id),
  status      text not null check (status in ('ok', 'partial', 'failed')),
  resources   jsonb not null default '{}',   -- { "<query>": { "rows": n, "error": "..." } }
  error       text,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  primary key (sync_run_id, customer_id)
);

-- ---------------------------------------------------------------------------
-- RLS helpers. SECURITY DEFINER so policies can read profiles/ad_accounts
-- without recursing into their own policies. Empty search_path, fully
-- qualified names.
-- ---------------------------------------------------------------------------
create or replace function app.my_role()
returns public.app_role
language sql stable security definer
set search_path = ''
as $$
  select p.role from public.profiles p
  where p.user_id = auth.uid() and not p.disabled
$$;

create or replace function app.my_client_id()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select p.client_id from public.profiles p
  where p.user_id = auth.uid() and not p.disabled and p.role = 'client_viewer'
$$;

create or replace function app.is_agency()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(app.my_role() in ('rob_admin', 'ff_staff'), false)
$$;

create or replace function app.has_profile()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.my_role() is not null
$$;

create or replace function app.can_read_client(p_client_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_agency() or (p_client_id is not null and p_client_id = app.my_client_id())
$$;

create or replace function app.can_read_customer(p_customer_id text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select app.is_agency() or exists (
    select 1 from public.ad_accounts a
    where a.customer_id = p_customer_id
      and a.client_id is not null
      and a.client_id = app.my_client_id()
  )
$$;

revoke all on schema app from public;
grant usage on schema app to authenticated;
revoke all on all functions in schema app from public;
grant execute on function
  app.my_role(), app.my_client_id(), app.is_agency(), app.has_profile(),
  app.can_read_client(uuid), app.can_read_customer(text)
  to authenticated;
