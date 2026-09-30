-- Google Ads structure: current state of each account, written by ff-sync.
--
-- Conventions (PLAN.md section 4):
--   - Every row carries customer_id; RLS isolates clients through it.
--   - Google ids are text (64-bit ids overflow JS numbers).
--   - Upserts on the natural key. Things that disappear in Google Ads get
--     removed_at set, never deleted, so history survives.
--   - Only ad_accounts is a foreign key target. Links between Google tables are
--     by id without FKs, so a sync that writes resources in any order never
--     fails on a missing parent.

create table public.campaigns (
  id                       uuid not null default gen_random_uuid() unique,  -- used in dashboard URLs
  customer_id              text not null references public.ad_accounts(customer_id),
  campaign_id              text not null,
  name                     text not null,
  status                   text,
  serving_status           text,
  primary_status           text,
  primary_status_reasons   text[] not null default '{}',
  channel_type             text,
  channel_sub_type         text,
  bidding_strategy_type    text,
  target_cpa_micros        bigint,
  target_roas              numeric,
  budget_id                text,
  budget_micros            bigint,
  budget_delivery          text,
  budget_shared            boolean,
  network_search           boolean,
  network_partners         boolean,
  network_display          boolean,
  positive_geo_target_type text,   -- SOP wants PRESENCE (people in the area), not interest
  negative_geo_target_type text,
  start_date               date,
  end_date                 date,
  removed_at               timestamptz,
  synced_at                timestamptz not null default now(),
  primary key (customer_id, campaign_id)
);

create table public.campaign_targets (
  customer_id          text not null references public.ad_accounts(customer_id),
  campaign_id          text not null,
  criterion_id         text not null,
  type                 text not null,  -- LOCATION, PROXIMITY, LANGUAGE, AD_SCHEDULE, DEVICE
  negative             boolean not null default false,
  status               text,
  bid_modifier         numeric,
  geo_target_constant  text,
  radius               numeric,
  radius_units         text,
  language_constant    text,
  day_of_week          text,
  start_hour           int,
  start_minute         text,
  end_hour             int,
  end_minute           text,
  device               text,
  removed_at           timestamptz,
  synced_at            timestamptz not null default now(),
  primary key (customer_id, campaign_id, criterion_id)
);

-- Lookup cache for geo target constant names. Not client data.
create table public.geo_targets (
  geo_target_constant text primary key,   -- geoTargetConstants/1002451
  name                text,
  canonical_name      text,
  target_type         text,
  country_code        text,
  synced_at           timestamptz not null default now()
);

create table public.ad_groups (
  customer_id    text not null references public.ad_accounts(customer_id),
  ad_group_id    text not null,
  campaign_id    text not null,
  name           text not null,
  status         text,
  type           text,
  cpc_bid_micros bigint,
  removed_at     timestamptz,
  synced_at      timestamptz not null default now(),
  primary key (customer_id, ad_group_id)
);
create index ad_groups_campaign_idx on public.ad_groups(customer_id, campaign_id);

create table public.keywords (
  customer_id               text not null references public.ad_accounts(customer_id),
  ad_group_id               text not null,
  criterion_id              text not null,
  campaign_id               text not null,
  text                      text not null,
  match_type                text,
  status                    text,
  system_serving_status     text,
  approval_status           text,
  cpc_bid_micros            bigint,
  effective_cpc_bid_micros  bigint,
  final_url                 text,
  quality_score             int,
  qs_creative               text,   -- BELOW_AVERAGE / AVERAGE / ABOVE_AVERAGE
  qs_landing_page           text,
  qs_expected_ctr           text,
  first_page_cpc_micros     bigint,
  top_of_page_cpc_micros    bigint,
  first_position_cpc_micros bigint,
  removed_at                timestamptz,
  synced_at                 timestamptz not null default now(),
  primary key (customer_id, ad_group_id, criterion_id)
);
create index keywords_campaign_idx on public.keywords(customer_id, campaign_id);

create table public.shared_sets (
  customer_id   text not null references public.ad_accounts(customer_id),
  shared_set_id text not null,
  name          text not null,
  type          text,
  status        text,
  member_count  int,
  removed_at    timestamptz,
  synced_at     timestamptz not null default now(),
  primary key (customer_id, shared_set_id)
);

create table public.campaign_shared_sets (
  customer_id   text not null references public.ad_accounts(customer_id),
  campaign_id   text not null,
  shared_set_id text not null,
  status        text,
  removed_at    timestamptz,
  synced_at     timestamptz not null default now(),
  primary key (customer_id, campaign_id, shared_set_id)
);

-- All negative keywords in one table. scope_id is the campaign id, ad group id
-- or shared set id depending on level ('account' uses the customer id).
create table public.negatives (
  customer_id   text not null references public.ad_accounts(customer_id),
  level         text not null check (level in ('account', 'campaign', 'ad_group', 'shared_list')),
  scope_id      text not null,
  criterion_id  text not null,
  campaign_id   text,
  ad_group_id   text,
  shared_set_id text,
  text          text not null,
  match_type    text,
  removed_at    timestamptz,
  synced_at     timestamptz not null default now(),
  primary key (customer_id, level, scope_id, criterion_id)
);
create index negatives_campaign_idx on public.negatives(customer_id, campaign_id);
create index negatives_shared_set_idx on public.negatives(customer_id, shared_set_id);

create table public.ads (
  customer_id     text not null references public.ad_accounts(customer_id),
  ad_group_id     text not null,
  ad_id           text not null,
  campaign_id     text not null,
  type            text,
  status          text,
  ad_strength     text,
  final_urls      text[] not null default '{}',
  path1           text,
  path2           text,
  headlines       jsonb not null default '[]',   -- [{ text, pinned_field }]
  descriptions    jsonb not null default '[]',
  approval_status text,
  review_status   text,
  policy_topics   jsonb not null default '[]',
  removed_at      timestamptz,
  synced_at       timestamptz not null default now(),
  primary key (customer_id, ad_group_id, ad_id)
);
create index ads_campaign_idx on public.ads(customer_id, campaign_id);

-- RSA asset performance labels, with a rolling 30-day metrics snapshot.
create table public.ad_asset_labels (
  customer_id       text not null references public.ad_accounts(customer_id),
  ad_group_id       text not null,
  ad_id             text not null,
  asset_id          text not null,
  field_type        text not null,   -- HEADLINE / DESCRIPTION
  campaign_id       text,
  text              text,
  performance_label text,            -- BEST / GOOD / LOW / LEARNING / PENDING
  pinned_field      text,
  enabled           boolean,
  impressions_30d   bigint not null default 0,
  clicks_30d        bigint not null default 0,
  cost_micros_30d   bigint not null default 0,
  conversions_30d   numeric not null default 0,
  synced_at         timestamptz not null default now(),
  primary key (customer_id, ad_group_id, ad_id, asset_id, field_type)
);

-- Extensions (call, sitelink, callout, structured snippet, location) at account,
-- campaign or ad group level. phone_number is the business line on a call asset.
create table public.assets (
  customer_id                     text not null references public.ad_accounts(customer_id),
  level                           text not null check (level in ('account', 'campaign', 'ad_group')),
  scope_id                        text not null,
  asset_id                        text not null,
  field_type                      text not null,
  campaign_id                     text,
  ad_group_id                     text,
  type                            text,
  name                            text,
  status                          text,
  primary_status                  text,
  text                            text,
  description1                    text,
  description2                    text,
  final_url                       text,
  phone_number                    text,
  call_conversion_reporting_state text,
  call_conversion_action          text,
  removed_at                      timestamptz,
  synced_at                       timestamptz not null default now(),
  primary key (customer_id, level, scope_id, asset_id, field_type)
);

create table public.conversion_actions (
  customer_id                 text not null references public.ad_accounts(customer_id),
  conversion_action_id        text not null,
  name                        text not null,
  category                    text,
  type                        text,
  origin                      text,
  status                      text,
  counting_type               text,
  primary_for_goal            boolean,
  include_in_conversions      boolean,
  default_value               numeric,
  always_use_default_value    boolean,
  click_lookback_days         int,
  phone_call_duration_seconds int,    -- SOP: 90 for the calls action
  attribution_model           text,
  removed_at                  timestamptz,
  synced_at                   timestamptz not null default now(),
  primary key (customer_id, conversion_action_id)
);

create table public.recommendations (
  resource_name          text primary key,
  customer_id            text not null references public.ad_accounts(customer_id),
  campaign_id            text,
  ad_group_id            text,
  type                   text not null,
  dismissed              boolean not null default false,
  impact                 jsonb not null default '{}',   -- Google omits it for some types
  est_extra_clicks       numeric not null default 0,
  est_extra_conversions  numeric not null default 0,
  est_cost_change_micros bigint not null default 0,
  -- open: seen in the latest sync. expired: Google stopped returning it.
  -- hidden: hidden on the dashboard by FF staff.
  status                 text not null default 'open' check (status in ('open', 'expired', 'hidden')),
  first_seen_at          timestamptz not null default now(),
  last_seen_at           timestamptz not null default now(),
  synced_at              timestamptz not null default now()
);
create index recommendations_campaign_idx on public.recommendations(customer_id, campaign_id);

-- Agency-only (user_email is the Google login of whoever made the change).
create table public.change_events (
  resource_name    text primary key,
  customer_id      text not null references public.ad_accounts(customer_id),
  changed_at       timestamptz not null,
  resource_type    text,
  changed_resource text,
  operation        text,
  client_type      text,   -- GOOGLE_ADS_API rows during a sync would break the read-only rule
  user_email       text,
  changed_fields   text[] not null default '{}',
  campaign_id      text,
  ad_group_id      text,
  synced_at        timestamptz not null default now()
);
create index change_events_customer_time_idx on public.change_events(customer_id, changed_at desc);
