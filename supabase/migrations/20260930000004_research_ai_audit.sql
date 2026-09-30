-- Keyword research cache, search term triage, AI chat, client messages,
-- audits and the Phase 6 write log.

-- Keyword volume from Google Keyword Planner (now) and DataForSEO (Phase 7).
-- Shared lookup data, not tied to a client.
create table public.keyword_volume (
  source               text not null check (source in ('google_kp', 'dataforseo')),
  keyword_norm         text not null,
  geo_target           text not null default '',   -- geoTargetConstants/<id> or DataForSEO location code
  language             text not null default '',
  fetched_month        date not null,               -- first day of the month the numbers were fetched
  avg_monthly_searches bigint,
  competition          text,
  competition_index    int,
  low_top_bid_micros   bigint,
  high_top_bid_micros  bigint,
  avg_cpc_micros       bigint,
  monthly_searches     jsonb not null default '[]',
  related_keywords     jsonb not null default '[]', -- Phase 7 (DataForSEO)
  synced_at            timestamptz not null default now(),
  primary key (source, keyword_norm, geo_target, language, fetched_month)
);

-- Weekly search term triage (PDF "search_terms"): keep / block / ask Rob.
-- Written by the ff-search-term-triage webhook. Agency-only.
create table public.search_term_triage (
  customer_id  text not null references public.ad_accounts(customer_id),
  campaign_id  text not null,
  term_hash    text not null check (term_hash ~ '^[0-9a-f]{64}$'),
  search_term  text not null,   -- the filtered term, same as search_term_daily
  theme        text,
  decision     text not null check (decision in ('keep', 'block', 'ask_rob')),
  note         text,
  decided_by   uuid references auth.users(id) on delete set null,
  decided_at   timestamptz not null default now(),
  primary key (customer_id, campaign_id, term_hash)
);

-- Agency <-> AI chat about one campaign. Agency-only.
create table public.campaign_chat_messages (
  id              uuid primary key default gen_random_uuid(),
  customer_id     text not null references public.ad_accounts(customer_id),
  campaign_id     text not null,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  -- { action_type: update_daily_budget | pause_campaign | resume_campaign, daily_budget_usd, reason }
  proposed_action jsonb,
  action_status   text check (action_status in ('proposed', 'applied', 'dismissed')),
  is_proactive    boolean not null default false,
  author_id       uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index campaign_chat_messages_campaign_idx
  on public.campaign_chat_messages(customer_id, campaign_id, created_at);

-- Client Suggestions thread (client <-> FF). Visible to the client and FF.
create table public.client_messages (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  customer_id text references public.ad_accounts(customer_id),
  campaign_id text,
  direction   text not null check (direction in ('inbound', 'outbound')),
  body        text not null,
  status      text not null default 'new' check (status in ('new', 'drafted', 'answered', 'dismissed')),
  author_id   uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint campaign_needs_customer check (campaign_id is null or customer_id is not null)
);
create index client_messages_client_idx on public.client_messages(client_id, created_at);

-- AI drafts for inbound client messages. Agency-only, so clients never see drafts.
create table public.message_drafts (
  message_id      uuid primary key references public.client_messages(id) on delete cascade,
  draft_body      text not null,
  proposed_action jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger message_drafts_set_updated_at
  before update on public.message_drafts
  for each row execute function app.set_updated_at();

-- Read-only audits per pilot account (Phase 5). Agency-only.
create table public.audits (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients(id) on delete cascade,
  customer_id text not null references public.ad_accounts(customer_id),
  period_from date not null,
  period_to   date not null,
  summary     jsonb not null default '{}',
  markdown    text not null,
  status      text not null default 'draft' check (status in ('draft', 'reviewed_by_rob')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);
create index audits_client_idx on public.audits(client_id, created_at desc);

-- Every Google Ads write (Phase 6). Agency-only.
create table public.write_log (
  id              uuid primary key default gen_random_uuid(),
  actor_id        uuid references auth.users(id) on delete set null,
  actor_role      public.app_role,
  customer_id     text not null references public.ad_accounts(customer_id),
  is_test_account boolean not null,
  workflow        text not null,
  operation       text not null,
  validate_only   boolean not null default false,
  request         jsonb not null,
  response        jsonb,
  status          text not null check (status in ('ok', 'failed', 'refused')),
  created_at      timestamptz not null default now()
);
create index write_log_customer_idx on public.write_log(customer_id, created_at desc);
