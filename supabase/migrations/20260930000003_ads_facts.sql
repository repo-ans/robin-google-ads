-- Daily facts. Upserted on the natural key; the rolling 30-day (daily) and
-- 90-day (weekly) windows rewrite recent days so late conversions land.
-- Dates are the account's local date (segments.date).
-- CTR, average CPC and cost per conversion are derived from sums in queries,
-- never stored (averaging daily averages gives the wrong answer).

create table public.campaign_daily (
  customer_id              text not null references public.ad_accounts(customer_id),
  campaign_id              text not null,
  date                     date not null,
  impressions              bigint not null default 0,
  clicks                   bigint not null default 0,
  cost_micros              bigint not null default 0,
  conversions              numeric not null default 0,
  conversions_value        numeric not null default 0,
  all_conversions          numeric not null default 0,
  all_conversions_value    numeric not null default 0,
  view_through_conversions numeric not null default 0,
  phone_calls              bigint not null default 0,
  phone_impressions        bigint not null default 0,
  search_impression_share  numeric,
  search_budget_lost_is    numeric,
  search_rank_lost_is      numeric,
  search_top_is            numeric,
  search_abs_top_is        numeric,
  top_impression_pct       numeric,
  abs_top_impression_pct   numeric,
  synced_at                timestamptz not null default now(),
  primary key (customer_id, campaign_id, date)
);

create table public.ad_group_daily (
  customer_id           text not null references public.ad_accounts(customer_id),
  ad_group_id           text not null,
  date                  date not null,
  campaign_id           text not null,
  impressions           bigint not null default 0,
  clicks                bigint not null default 0,
  cost_micros           bigint not null default 0,
  conversions           numeric not null default 0,
  conversions_value     numeric not null default 0,
  all_conversions       numeric not null default 0,
  all_conversions_value numeric not null default 0,
  phone_calls           bigint not null default 0,
  synced_at             timestamptz not null default now(),
  primary key (customer_id, ad_group_id, date)
);
create index ad_group_daily_campaign_idx on public.ad_group_daily(customer_id, campaign_id, date);

create table public.keyword_daily (
  customer_id             text not null references public.ad_accounts(customer_id),
  ad_group_id             text not null,
  criterion_id            text not null,
  date                    date not null,
  campaign_id             text not null,
  impressions             bigint not null default 0,
  clicks                  bigint not null default 0,
  cost_micros             bigint not null default 0,
  conversions             numeric not null default 0,
  conversions_value       numeric not null default 0,
  all_conversions         numeric not null default 0,
  search_impression_share numeric,
  synced_at               timestamptz not null default now(),
  primary key (customer_id, ad_group_id, criterion_id, date)
);
create index keyword_daily_campaign_idx on public.keyword_daily(customer_id, campaign_id, date);

-- search_term is stored only AFTER the n8n name filter (PLAN.md 5.4).
-- term_hash = sha256 hex of the stored (filtered, normalized) term, so the key
-- stays short and filtered terms collapse into one row per intent.
create table public.search_term_daily (
  customer_id            text not null references public.ad_accounts(customer_id),
  ad_group_id            text not null,
  term_hash              text not null check (term_hash ~ '^[0-9a-f]{64}$'),
  keyword_criterion_id   text not null default '',
  date                   date not null,
  campaign_id            text not null,
  search_term            text not null,
  name_filtered          boolean not null default false,
  status                 text,   -- ADDED / EXCLUDED / ADDED_EXCLUDED / NONE
  keyword_text           text,
  keyword_match_type     text,
  search_term_match_type text,
  impressions            bigint not null default 0,
  clicks                 bigint not null default 0,
  cost_micros            bigint not null default 0,
  conversions            numeric not null default 0,
  conversions_value      numeric not null default 0,
  all_conversions        numeric not null default 0,
  synced_at              timestamptz not null default now(),
  primary key (customer_id, ad_group_id, term_hash, keyword_criterion_id, date)
);
create index search_term_daily_campaign_idx on public.search_term_daily(customer_id, campaign_id, date);

create table public.ad_daily (
  customer_id       text not null references public.ad_accounts(customer_id),
  ad_group_id       text not null,
  ad_id             text not null,
  date              date not null,
  campaign_id       text not null,
  impressions       bigint not null default 0,
  clicks            bigint not null default 0,
  cost_micros       bigint not null default 0,
  conversions       numeric not null default 0,
  conversions_value numeric not null default 0,
  synced_at         timestamptz not null default now(),
  primary key (customer_id, ad_group_id, ad_id, date)
);

create table public.asset_daily (
  customer_id       text not null references public.ad_accounts(customer_id),
  level             text not null,
  scope_id          text not null,
  asset_id          text not null,
  field_type        text not null,
  date              date not null,
  campaign_id       text,
  impressions       bigint not null default 0,
  clicks            bigint not null default 0,
  cost_micros       bigint not null default 0,
  conversions       numeric not null default 0,
  phone_calls       bigint not null default 0,
  synced_at         timestamptz not null default now(),
  primary key (customer_id, level, scope_id, asset_id, field_type, date)
);

-- Conversions split by conversion action. Feeds "last conversion date".
create table public.conversion_daily (
  customer_id           text not null references public.ad_accounts(customer_id),
  campaign_id           text not null,
  conversion_action_id  text not null,
  date                  date not null,
  conversions           numeric not null default 0,
  conversions_value     numeric not null default 0,
  all_conversions       numeric not null default 0,
  all_conversions_value numeric not null default 0,
  synced_at             timestamptz not null default now(),
  primary key (customer_id, campaign_id, conversion_action_id, date)
);
create index conversion_daily_action_idx on public.conversion_daily(customer_id, conversion_action_id, date);

create table public.hourly_stats (
  customer_id text not null references public.ad_accounts(customer_id),
  campaign_id text not null,
  date        date not null,
  hour        smallint not null check (hour between 0 and 23),
  day_of_week text not null,   -- MONDAY..SUNDAY, as Google returns it
  impressions bigint not null default 0,
  clicks      bigint not null default 0,
  cost_micros bigint not null default 0,
  conversions numeric not null default 0,
  phone_calls bigint not null default 0,
  synced_at   timestamptz not null default now(),
  primary key (customer_id, campaign_id, date, hour)
);

create table public.device_daily (
  customer_id       text not null references public.ad_accounts(customer_id),
  campaign_id       text not null,
  date              date not null,
  device            text not null,
  impressions       bigint not null default 0,
  clicks            bigint not null default 0,
  cost_micros       bigint not null default 0,
  conversions       numeric not null default 0,
  conversions_value numeric not null default 0,
  synced_at         timestamptz not null default now(),
  primary key (customer_id, campaign_id, date, device)
);

create table public.geo_daily (
  customer_id          text not null references public.ad_accounts(customer_id),
  campaign_id          text not null,
  date                 date not null,
  location_type        text not null,   -- LOCATION_OF_PRESENCE / AREA_OF_INTEREST
  geo_target_constant  text not null default '',
  country_criterion_id text,
  impressions          bigint not null default 0,
  clicks               bigint not null default 0,
  cost_micros          bigint not null default 0,
  conversions          numeric not null default 0,
  synced_at            timestamptz not null default now(),
  primary key (customer_id, campaign_id, date, location_type, geo_target_constant)
);

-- Calls from call assets and the website snippet. No caller number, area code
-- or country code is ever stored (hard rule 4).
create table public.calls (
  customer_id        text not null references public.ad_accounts(customer_id),
  call_resource_name text not null,
  campaign_id        text,
  ad_group_id        text,
  start_at           timestamptz,
  end_at             timestamptz,
  duration_seconds   int not null default 0,
  status             text,   -- RECEIVED / MISSED
  type               text,
  display_location   text,   -- AD / LANDING_PAGE
  is_90s_plus        boolean generated always as (duration_seconds >= 90) stored,
  synced_at          timestamptz not null default now(),
  primary key (customer_id, call_resource_name)
);
create index calls_campaign_idx on public.calls(customer_id, campaign_id, start_at);
