# PLAN.md - FF Google Ads Dashboard

Status: **Built (all at once, 2026-09-30).** Phases were dropped at Manam's request; the phase table in section 11 is kept for history only.
Last updated: 2026-09-30.

Sources read: `ANS-Google-Ads/` (site, schema, README, n8n README), every node and note in `n8n/*.json`
(the root copies, which are newer than `ANS-Google-Ads/n8n/`), the scope PDF (Version 1 rules, Version 2 plan),
and the three reference screenshots.

Contents
1. Decisions and changes from the reference
2. Repo layout
3. Auth, roles and RLS
4. Supabase schema
5. Sync design (n8n)
6. GAQL queries
7. n8n workflows (triggers, roles, status)
8. Page map (dashboard)
9. Everything the reference hardcodes
10. Environment and config
11. Phases and acceptance checks
12. Open questions for Manam / Rob

---

## 1. Decisions and changes from the reference

| Area | Reference (ANS) | FF plan | Why |
|---|---|---|---|
| Client access | Magic link `/client/:clientId` (UUID is the token), anon SECURITY DEFINER RPCs | Real Supabase login per client user, `client_viewer` role, RLS | A leaked URL gave full access; no way to revoke |
| Agency auth | Any `authenticated` user can read/write everything | Roles in `profiles`; agency roles read all, nobody writes from the browser | Multi-tenant |
| Browser writes | Frontend inserts/updates/deletes `clients`, `campaigns`, `campaign_chat_messages`, `google_ads_settings`, `messages` | All go through n8n webhooks | Data-flow rule |
| Public signup / intake | `anon` can insert clients and campaigns | Removed. Supabase "Allow new users to sign up" turned off | Nobody outside FF creates anything |
| Google Ads secrets | `google_ads_settings` table, readable and editable by any logged-in user from `/settings` | n8n credentials (preferred) or a private, service-role-only table. Never on a page. See 3.5 | Rule 5 |
| Accounts | `clients.google_ads_customer_id` (one per client) + `googleads-<id>@discovered.local` placeholder clients | `ad_accounts` table (many per client, `client_id` nullable = Unassigned) with `login_customer_id` per account | Clients have several accounts; no fake clients |
| Direct-access accounts | `DIRECT_ACCESS_CUSTOMER_IDS = ['3534195221']` in 6 workflows | `ad_accounts.login_customer_id` (null = omit header) | Config, not code |
| Campaign key | Internal uuid + `google_ads_campaign_resource` | Natural key `(customer_id, campaign_id)`; uuid kept only for URLs | Upserts need natural keys |
| Metrics | 5 fields, campaign level | Every level in the brief (section 6) | Scope |
| Removed campaigns | Hard delete + cascade (history lost) | Soft mark `removed_at`, history kept | Case match and reporting need history |
| Recommendations | Delete open rows, re-insert (delete-then-create) | Upsert on `resource_name`, mark missing rows `expired` | Same bug class as the metrics fix |
| Sync structure | One 39-node workflow, index pairing across branches | Same workflows and flow as the reference (decided 2026-09-30), each file self-contained. `ff-sync` adds a per-account Loop Over Items with continue-on-error, key-based matching, and the new resources. DataForSEO added as its own workflow | Same shape the team knows; one account failing still cannot stop the others |
| API version | `v25` literal in ~20 URLs | One `API_VERSION` value in each workflow's Config node | One place to bump. v25 is inside support (v22 sunsets 2026-10-07); confirm on the sunset page in Phase 2 |
| Supabase URL | Hardcoded `pbeqzrpyxnglppqofeqq` in 2 HTTP nodes | Config node per workflow | Never reuse the reference project |
| LLM | OpenAI `gpt-5-mini`, credential "Manam- OpenAi account" | FF-owned credential; model set in config | Rule 1 |
| Currency | `USD` hardcoded in the frontend formatter | `ad_accounts.currency_code` | FF clients may bill in CAD |
| Charts | Hand-rolled SVG `TrendChart` | Keep it; add SVG heatmap and bar split. No chart library | Small bundle, prints well |
| Theme | Light only | Light/dark/system switcher (Tailwind v4 class variant, remembered per browser) | Requested |

**Supabase Edge Functions / cron:** none planned. Everything scheduled runs in n8n.

---

## 2. Repo layout (FF private GitHub repo)

```
/                     repo root (this folder)
  CLAUDE.md
  PLAN.md
  netlify.toml        base = "web"
  .gitignore          .env*, node_modules, dist, ANS-Google-Ads/, reference/, case-lists/
  .env.example
  web/                React + Vite + TS + Tailwind v4
    src/lib/          supabaseClient, useAuth, useProfile, n8n.ts (webhook caller), format.ts, csv.ts, dateRange.ts
    src/components/
    src/pages/
    src/styles/print.css
  supabase/
    migrations/       0001_roles_profiles.sql, 0002_core.sql, 0003_ads_data.sql, ...
    tests/            pgTAP RLS tests (scripts/test-db-local.mjs, or psql on the dev project)
    seed.sql          local-only fake data, no real IDs
  n8n/                ff-*.json exports
  audits/             <client-slug>.md (slug, never a person's name)
  scripts/            check-n8n.mjs, rls-e2e.test.ts
```

The current root `n8n/` holds the reference exports. In Phase 1 I will move them to `reference/n8n-ans/`
(gitignored) so `n8n/` holds only FF workflows. `ANS-Google-Ads/` stays where it is and is gitignored.

---

## 3. Auth, roles and RLS

### 3.1 profiles

```sql
create type app_role as enum ('rob_admin', 'ff_staff', 'client_viewer');

create table profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null,               -- login email (FF staff or funeral home staff, never a family member)
  role       app_role not null,
  client_id  uuid references clients(id) on delete restrict,
  disabled   boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_viewer_needs_client check (
    (role = 'client_viewer' and client_id is not null) or (role <> 'client_viewer' and client_id is null)
  )
);
```

### 3.2 Helper functions (schema `app`, SECURITY DEFINER, `stable`, `search_path = ''`)

```sql
app.my_role()        -> app_role   -- null if no profile or disabled
app.my_client_id()   -> uuid
app.is_agency()      -> boolean    -- my_role() in ('rob_admin','ff_staff')
app.can_read_client(p_client_id uuid) -> boolean
      -- is_agency() or p_client_id = my_client_id()
app.can_read_customer(p_customer_id text) -> boolean
      -- is_agency() or exists (select 1 from ad_accounts a
      --   where a.customer_id = p_customer_id and a.client_id = my_client_id())
```

Policies call them as `(select app.can_read_customer(customer_id))` style where possible so Postgres caches per statement.

### 3.3 Policy matrix

| Table group | anon | authenticated SELECT | authenticated INSERT/UPDATE/DELETE |
|---|---|---|---|
| `profiles` | none | own row, or `is_agency()` | none |
| `clients` | none | `can_read_client(id)` | none |
| `ad_accounts` | none | `is_agency()` or `client_id = my_client_id()` | none |
| All Google Ads data tables (have `customer_id`) | none | `can_read_customer(customer_id)` | none |
| `keyword_volume`, `geo_targets` (shared lookups) | none | any authenticated with a profile | none |
| `client_messages` (Client Suggestions thread) | none | `can_read_client(client_id)` | none |
| `message_drafts`, `campaign_chat_messages` | none | `is_agency()` | none |
| `audits`, `sync_runs`, `sync_run_accounts`, `change_events`, `write_log`, `search_term_triage` | none | `is_agency()` | none |
| `private.google_ads_secrets` (only if option B in 3.5) | none | none | none |

Also: `revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;`
and `revoke all ... from anon`. RLS plus revoked privileges, so one mistake does not open a hole.

All views: `create view ... with (security_invoker = true)`. Reporting RPCs used by the dashboard
(e.g. `campaign_summary(from, to)`) are `security invoker` so RLS still applies.

### 3.4 RLS tests (`supabase/tests/*.sql`, pgTAP, run with `node scripts/test-db-local.mjs` - no Docker)

Fixture: clients A and B, one account each, one row in every data table for each account;
users: `rob_admin`, `ff_staff`, viewer A, viewer B, disabled viewer A, user with no profile.

1. Every table in `public` has RLS enabled (query `pg_class.relrowsecurity`; test fails if a new table forgets it).
2. For every table with `customer_id` or `client_id`: viewer A sees only A rows, zero B rows.
   The table list comes from `information_schema`, so new tables are covered automatically.
3. Viewer A cannot see `campaign_chat_messages`, `message_drafts`, `audits`, `sync_runs`, `change_events`.
4. Disabled viewer and no-profile user see zero rows everywhere.
5. `authenticated` INSERT/UPDATE/DELETE fails on every business table, for every role.
6. `anon` sees nothing.
7. Reassigning an account from A to B moves visibility on the next query.

Phase 4 adds `scripts/rls-e2e.test.ts`: real logins through Supabase Auth against the FF project,
proving the same isolation through PostgREST and through the n8n webhooks (viewer A calling a webhook
with B's ids gets 403).

### 3.5 Secrets (decided 2026-09-30)

| Secret | Where | Entered by |
|---|---|---|
| Google Ads developer token, OAuth client id + secret, refresh token, MCC id | Supabase `private.google_ads_secrets` (migration 9) | Rob, on the dashboard Settings page ("Connect with Google" creates the refresh token) |
| Supabase service role key | n8n credential "FF Supabase (service role)" | FF, in n8n |
| OpenAI key | n8n credential "FF OpenAI" | FF, in n8n |
| Slack bot token | n8n credential "FF Slack" | FF, in n8n |
| DataForSEO login + password | n8n credential "FF DataForSEO" | FF, in n8n |
| GHL access for every client: FF's private GHL Marketplace app (installed by the agency on each sub-account; the agency token is exchanged for a sub-account token at run time). Replaces the agency private integration key (2026-10-06), which cannot open sub-accounts | n8n credential "FF GHL OAuth" (OAuth2) | FF, in n8n |
| Google Sheets login (client Sheets) | n8n credential "FF Google Sheets" (OAuth2) | FF, in n8n (added 2026-10-02) |

How the Google Ads values stay safe:
- Schema `private` is not exposed by the API; the table has RLS on with no policies and no privileges for
  `anon`/`authenticated`.
- The browser never reads a value. `google_ads_connection_status()` (agency roles only) returns set / not set,
  when, by whom, and a safe hint (client id, MCC id, last 4 characters of the developer token). RLS tests cover it.
- Writes go through n8n `ff-google-ads-settings` (rob_admin) into `ff_set_google_ads_secrets()` (service role only).
- n8n reads them with `ff_google_ads_secrets()` (service role only) in the "Get Google Ads secrets" node, then
  refreshes the OAuth token like the reference did.
- Workflows keep no data from successful executions; `ff-google-ads-settings` and `ff-client-admin` keep no
  execution data at all. Error executions of other workflows can contain the values, so n8n access stays FF-only.

### 3.6 Login flows

- First `rob_admin`: created once by hand in the FF Supabase dashboard, plus one SQL insert into `profiles`. Documented in the runbook.
- Client logins: agency user fills email and a temporary password on the client page, then n8n `ff-client-admin`
  calls `POST /auth/v1/admin/users` (`email_confirm: true`) and inserts `profiles`. If the profile insert fails, n8n deletes the auth user it just made.
- Reset password: admin API `PUT /auth/v1/admin/users/{id}` with a new temporary password.
- Disable: `ban_duration: "876000h"` + `profiles.disabled = true`. Enable reverses both.
- The user changes their own password on `/account` (direct `supabase.auth.updateUser`, allowed as an auth action).

---

## 4. Supabase schema

Conventions: `customer_id text` (10 digits, no dashes) on every Google Ads row. Google ids stored as `text`
(64-bit ids overflow JS numbers). `cost_micros bigint`. `synced_at timestamptz default now()` on every synced row.
`removed_at timestamptz` for soft removal. Dates are account-local (`segments.date`).

### 4.1 Core

| Table | Key | Main columns |
|---|---|---|
| `clients` | `id uuid` | `name`, `slug` (unique, used in audit file names), `website_url`, `phone` (business line), `towns text[]`, `service_area_notes`, `process` (`funeral_home` / `online_cremation`), `case_value_micros`, `currency_code`, `ghl_location_id`, `competitor_terms text[]` and `own_brand_terms text[]` (feed the negative list), `slack_channel`, `archived_at`, timestamps. No personal names. |
| `profiles` | `user_id` | see 3.1 |
| `ad_accounts` | `customer_id text` | `client_id uuid null` (null = Unassigned), `login_customer_id text null`, `descriptive_name`, `currency_code`, `time_zone`, `status`, `is_manager`, `is_test_account`, `manager_path`, `auto_tagging_enabled`, `call_reporting_enabled`, `call_conversion_reporting_enabled`, `conversion_tracking_status`, `sync_enabled bool default true`, `first_synced_at`, `last_synced_at`, `synced_at` |
| `sync_runs` | `id uuid` | `trigger` (`schedule`/`manual`), `requested_by uuid`, `started_at`, `finished_at`, `status`, `accounts_ok`, `accounts_failed`, `mutate_calls int` (must be 0 until Phase 6) |
| `sync_run_accounts` | `(sync_run_id, customer_id)` | `status`, `resources jsonb` (per-query row counts and errors), `error text` |

### 4.2 Structure (current state, upsert every sync, soft-remove)

| Table | Natural key | Columns |
|---|---|---|
| `campaigns` | `(customer_id, campaign_id)` + `id uuid` for URLs | `name`, `status`, `serving_status`, `primary_status`, `primary_status_reasons text[]`, `channel_type`, `channel_sub_type`, `bidding_strategy_type`, `target_cpa_micros`, `target_roas`, `budget_id`, `budget_micros`, `budget_delivery`, `budget_shared`, `network_search`, `network_partners`, `network_display`, `start_date`, `end_date`, `removed_at`, `synced_at` |
| `campaign_targets` | `(customer_id, campaign_id, criterion_id)` | `type` (LOCATION, PROXIMITY, LANGUAGE, AD_SCHEDULE, DEVICE), `negative`, `bid_modifier`, `geo_target_constant`, `radius`, `radius_units`, `language_constant`, `day_of_week`, `start_hour`, `start_minute`, `end_hour`, `end_minute`, `device`, `removed_at` |
| `campaign_geo_settings` | `(customer_id, campaign_id)` | `positive_geo_target_type` (PRESENCE vs PRESENCE_OR_INTEREST - the SOP wants presence only), `negative_geo_target_type` |
| `geo_targets` | `geo_target_constant` | `name`, `canonical_name`, `target_type`, `country_code` (lookup cache) |
| `ad_groups` | `(customer_id, ad_group_id)` | `campaign_id`, `name`, `status`, `type`, `cpc_bid_micros`, `removed_at` |
| `keywords` | `(customer_id, ad_group_id, criterion_id)` | `campaign_id`, `text`, `match_type`, `status`, `system_serving_status`, `approval_status`, `cpc_bid_micros`, `effective_cpc_bid_micros`, `final_url`, `quality_score`, `qs_creative`, `qs_landing_page`, `qs_expected_ctr`, `first_page_cpc_micros`, `top_of_page_cpc_micros`, `first_position_cpc_micros`, `removed_at` |
| `negatives` | `(customer_id, level, scope_id, criterion_id)` | `level` (`campaign`/`ad_group`/`shared_list`/`account`), `scope_id` (campaign, ad group or shared set id), `campaign_id`, `ad_group_id`, `shared_set_id`, `text`, `match_type`, `removed_at` |
| `shared_sets` | `(customer_id, shared_set_id)` | `name`, `type`, `status`, `member_count`, `removed_at` |
| `campaign_shared_sets` | `(customer_id, campaign_id, shared_set_id)` | `status`, `removed_at` |
| `ads` | `(customer_id, ad_group_id, ad_id)` | `campaign_id`, `type`, `status`, `ad_strength`, `final_urls text[]`, `path1`, `path2`, `headlines jsonb` (text, pinned_field), `descriptions jsonb`, `approval_status`, `review_status`, `policy_topics jsonb`, `removed_at` |
| `ad_asset_labels` | `(customer_id, ad_group_id, ad_id, asset_id, field_type)` | `text`, `performance_label`, `pinned_field`, `enabled`, plus 30-day metrics snapshot, `synced_at` |
| `assets` | `(customer_id, level, scope_id, asset_id, field_type)` | `level` (account/campaign/ad_group), `type` (CALL, SITELINK, CALLOUT, LOCATION, STRUCTURED_SNIPPET), `status`, `primary_status`, `text` (sitelink text / callout text / snippet values), `description1`, `description2`, `final_url`, `phone_number` (business line only), `call_conversion_reporting_state`, `call_conversion_action`, `removed_at` |
| `conversion_actions` | `(customer_id, conversion_action_id)` | `name`, `category`, `type`, `origin`, `status`, `counting_type`, `primary_for_goal`, `include_in_conversions`, `default_value`, `always_use_default_value`, `click_lookback_days`, `phone_call_duration_seconds` (should be 90 for the call action), `attribution_model`, `removed_at` |
| `recommendations` | `resource_name` | `customer_id`, `campaign_id`, `ad_group_id`, `type`, `dismissed`, `impact jsonb` (may be `{}`), `est_extra_clicks`, `est_extra_conversions`, `est_cost_change_micros`, `status` (`open`/`expired`/`hidden`), `first_seen_at`, `last_seen_at` |
| `change_events` | `resource_name` | `customer_id`, `changed_at`, `resource_type`, `changed_resource`, `operation`, `client_type`, `user_email` (Google account of the person making the change), `changed_fields text[]`, `campaign_id`, `ad_group_id`. Agency-only. |

### 4.3 Daily facts (upsert on the key; the 30-day window rewrites itself)

Shared metric columns (`M`): `impressions`, `clicks`, `cost_micros`, `conversions numeric`, `conversions_value numeric`,
`all_conversions numeric`, `all_conversions_value numeric`, `phone_calls`, `phone_impressions`, `synced_at`.
CTR, average CPC and cost/conv are computed in views from sums, never stored (averages of averages go wrong).

| Table | Natural key | Extra columns |
|---|---|---|
| `campaign_daily` | `(customer_id, campaign_id, date)` | `M` + `view_through_conversions`, `search_impression_share`, `search_budget_lost_is`, `search_rank_lost_is`, `search_top_is`, `search_abs_top_is`, `top_impression_pct`, `abs_top_impression_pct`, `eligible_impressions_est` (impressions / IS, used to weight IS across days) |
| `ad_group_daily` | `(customer_id, ad_group_id, date)` | `campaign_id`, `M` |
| `keyword_daily` | `(customer_id, ad_group_id, criterion_id, date)` | `campaign_id`, `M`, `search_impression_share` |
| `search_term_daily` | `(customer_id, ad_group_id, term_hash, keyword_criterion_id, date)` | `campaign_id`, `search_term` (after name filter), `term_hash` (sha256 of normalized stored term), `status` (ADDED/EXCLUDED/ADDED_EXCLUDED/NONE), `keyword_text`, `keyword_match_type`, `search_term_match_type`, `M` |
| `ad_daily` | `(customer_id, ad_group_id, ad_id, date)` | `campaign_id`, `M` |
| `asset_daily` | `(customer_id, level, scope_id, asset_id, field_type, date)` | `M` |
| `conversion_daily` | `(customer_id, campaign_id, conversion_action_id, date)` | `conversions`, `conversions_value`, `all_conversions`, `all_conversions_value` |
| `hourly_stats` | `(customer_id, campaign_id, date, hour)` | `day_of_week`, `M` (heatmap = sum by day_of_week x hour) |
| `device_daily` | `(customer_id, campaign_id, date, device)` | `M` |
| `geo_daily` | `(customer_id, campaign_id, date, location_type, geo_target_constant)` | `location_type` (LOCATION_OF_PRESENCE / AREA_OF_INTEREST), `country_criterion_id`, `M` |
| `calls` | `(customer_id, call_resource_name)` | `campaign_id`, `ad_group_id`, `start_at`, `end_at`, `duration_seconds`, `status` (RECEIVED/MISSED), `type` (MANUALLY_DIALED/HIGH_END_MOBILE_SEARCH), `display_location` (AD/LANDING_PAGE), `is_90s_plus` (generated). **No caller number, area code or country code.** |

### 4.4 Keyword research and triage

| Table | Key | Columns |
|---|---|---|
| `keyword_volume` | `(source, keyword_norm, geo_target, language, fetched_month)` | `source` (`google_kp` now, `dataforseo` in Phase 7), `avg_monthly_searches`, `competition`, `competition_index`, `low_top_bid_micros`, `high_top_bid_micros`, `avg_cpc_micros`, `monthly_searches jsonb`, `synced_at` |
| `search_term_triage` | `(customer_id, campaign_id, term_hash)` | `theme`, `decision` (`keep`/`block`/`ask_rob`), `decided_by`, `decided_at`, `note`. Written by webhook. Matches PDF `search_terms`. |

### 4.5 AI, messages, audits, writes

| Table | Key | Notes |
|---|---|---|
| `campaign_chat_messages` | `id` | `customer_id`, `campaign_id`, `role`, `content`, `proposed_action jsonb`, `action_status`, `author_id`, `created_at`. Agency-only. |
| `client_messages` | `id` | Client Suggestions thread: `client_id`, `campaign_row_id` (nullable), `direction`, `body`, `author_id`, `status`, `created_at`. |
| `message_drafts` | `message_id` | AI draft + `proposed_action` for an inbound message. Agency-only, so clients never see drafts. |
| `audits` | `id` | `client_id`, `customer_id`, `period_from`, `period_to`, `summary jsonb`, `markdown text`, `status` (`draft`/`reviewed_by_rob`), `reviewed_at`. Agency-only. |
| `write_log` | `id` | Phase 6: every Google Ads write - `actor_id`, `role`, `customer_id`, `is_test_account`, `operation`, `request jsonb`, `response jsonb`, `status`, `created_at`. |

### 4.6 Views (all `security_invoker = true`)

- `v_campaign_totals(from, to)` RPC, `v_client_totals`, `v_agency_totals` - KPI cards and tables for any date range.
- `v_tracking_health` - per conversion action: `last_conversion_date` (max `date` with `all_conversions > 0` in `conversion_daily`),
  `spend_14d`, `flag = spend_14d > 0 and (last_conversion_date is null or last_conversion_date < current_date - 14)`.
  Also flags: call reporting off, call action duration not 90s, auto-tagging off, `positive_geo_target_type` not PRESENCE.
- `v_search_terms` - search terms with `is_negated` (see 5.5) and `triage.decision`.
- `v_negatives_all` - campaign, ad group and shared-list negatives for a campaign in one list, with the list name.
- `v_keyword_perf` - keywords + summed metrics + latest `keyword_volume`.

### 4.7 From the PDF, not in Phases 1-7 (tables added when those tasks start)

Built 2026-10-02 (migration 13): `weekly_stats` (one row per client per week, counts, flags, changes, decisions -
no personal data), `tracking_health` (weekly snapshot of each conversion action), `clients.google_sheet_id`, and the
n8n-only `ff_weekly_report()`. Website click id script `web/public/ff-click-id.js` and the GHL / Google Ads setup steps
in `docs/tracking-setup.md`.

Built 2026-10-05 (migration 20261005000002): `case_match_runs` (counts only - the list itself is never stored),
`ff_case_match_context()`, and `ff_action_context()` for source `negatives`. Process 2 purchase and "arrangement
started" tracking in `web/public/ff-click-id.js` (docs/tracking-setup.md section 6). Case match steps: section 7.

---

## 5. Sync design (n8n)

### 5.1 Workflow shape

Decision (2026-09-30): the FF workflows are the reference workflows, same set and same flow, re-pointed at FF
and extended. Every file stays self-contained (no sub-workflows), as in the reference, so each one imports on its own.

```
ff-sync  (Schedule 06:00 FF time zone  |  Webhook POST /ff/sync-now)
  webhook path only: Auth check block (ff_staff, rob_admin) -> 202 {sync_run_id} via Respond to Webhook
  Config (Set node: SUPABASE_URL, API_VERSION, MCC_ID, window sizes)          executeOnce
  Refresh Google Ads token (reference pattern)                               executeOnce
  insert sync_runs row
  Q1 customer_client from MCC  -> upsert ad_accounts (new accounts land with client_id = null)
  + ad_accounts where login_customer_id is null and sync_enabled (direct-access accounts)
  Loop Over Items (batch size 1 = one account per pass):
    for each resource block (Q2..Q27):
      HTTP googleAds:searchStream -> Code: map rows to table shape -> HTTP PostgREST upsert
      HTTP nodes: onError = continueRegularOutput, retry on 429/5xx (3 tries, backoff)
    soft-remove: structure rows not seen in this pass get removed_at = now()
    write sync_run_accounts row (per-query row counts and errors) -> next account
  update sync_runs
  tracking health + anomaly check -> Slack (only if something is flagged)
  AI proactive suggestion per campaign (reference logic + dedupe), onError continue
```

- Inside the loop there is only ever one account, so `.first()` on the loop item is always right, and results
  are matched by `customer_id` / `campaign_id` read from the response, never by index.
- Google Ads headers are built by one expression copied into each HTTP node (Authorization, developer-token,
  login-customer-id only when set). The API version comes from the Config node, not the URL literal.
- Upserts: one HTTP call per resource per account, rows sent as an array in chunks of 500,
  `POST /rest/v1/<table>?on_conflict=<cols>`, `Prefer: resolution=merge-duplicates,return=minimal`.
- Webhook workflows each carry the same 3-node Auth check block (validate input, `GET /auth/v1/user`,
  load `profiles` and check role) at the start. It is copied, not shared, to keep files self-contained.
  If it ever changes, `scripts/check-n8n.mjs` checks every copy is identical.

### 5.2 Windows

| Data | First sync of an account | Every daily sync | Weekly (Sunday) |
|---|---|---|---|
| Structure (campaigns, ad groups, keywords, negatives, ads, assets, conversion actions, targets) | full | full + soft-remove | - |
| `campaign_daily`, `ad_group_daily`, `conversion_daily` | 365 days | last 30 days | last 90 days (conversions keep landing for up to 90 days after the click) |
| `keyword_daily`, `search_term_daily`, `ad_daily`, `asset_daily`, `hourly_stats`, `device_daily`, `geo_daily` | 90 days | last 30 days | last 90 days |
| `calls` | 90 days | last 30 days | - |
| `recommendations` | current | current | - |
| `change_events` | 30 days (API maximum) | last 2 days | - |
| Keyword volume (Google KP) | once | - | once per month (data is monthly) |

API budget: about 25 queries per account per daily run. At 30 accounts that is under 1,000 operations,
far below the Basic access limit of 15,000 per day.

### 5.3 Read-only proof (Phase 2)

1. In `ff-sync`, every `googleads.googleapis.com` URL must end in `googleAds:searchStream`, `googleAds:search`
   or `:generateKeywordHistoricalMetrics`.
2. `scripts/check-n8n.mjs` scans every `n8n/ff-*.json`: fails on any other `googleads` URL in a read-only workflow,
   any `:mutate`, `:remove`, `:dismiss`, `:apply` or `:upload` string outside the three Phase 6 workflows,
   or any Phase 6 workflow marked active.
3. After a live sync, query `change_event` on each account for `client_type = GOOGLE_ADS_API` in the sync window: expect zero rows.
4. `sync_runs.mutate_calls` stays 0.

### 5.4 Name filter for search terms (hard rule 4)

Funeral searches often contain a deceased person's name ("<name> obituary"). The search term report would put
those names into Supabase. Before any search term is stored, prompted or written to an audit, a Code node:

1. Normalizes it (lowercase, trim, collapse spaces).
2. Marks it name-bearing if it contains an obituary-intent word (obituary, obit, obits, passed away, death notice,
   memorial for, service for, visitation for, funeral for, celebration of life for, in loving memory), or any token
   found in a bundled first-name / surname list that is not also in the allow list (town names from `clients.towns`,
   funeral vocabulary, the client's brand terms).
3. Name-bearing terms are stored as `[name removed - <intent>]` (for example `[name removed - obituary]`),
   with metrics kept, so spend on them still shows and can be blocked by theme.

This can remove some harmless terms. That is the safe direction. **Needs Rob's approval (see 12).**

### 5.5 "Already a negative" column

`v_search_terms.is_negated` uses an SQL function applying Google match semantics against every negative that
applies to the term's campaign/ad group (campaign level, ad group level, attached shared lists):
exact = same normalized text; phrase = the negative's words appear in order; broad = all the negative's words appear.
Google's own `search_term_view.status` (EXCLUDED) is shown too.

### 5.6 Anomaly and health alerts (Slack, only when something is flagged)

- Tracking: a conversion action with spend > 0 and no conversions for 14 days; call reporting off; call action not 90s.
- Spend: yesterday's cost above 1.5x the 14-day daily average, or above the budget cap.
- Delivery: a campaign enabled with zero impressions yesterday; any ad disapproved.
- Sync: any account failed.
Messages use plain hyphens, no emoji, no search terms that carry a name.

---

## 6. GAQL queries

Field names are written for v25 and are checked against the v25 reference in Phase 2, before any node is built.
`{from}`/`{to}` are account-local dates.

**Q1 Accounts (against the MCC, `login-customer-id` = MCC)**
```sql
SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code,
       customer_client.time_zone, customer_client.status, customer_client.manager,
       customer_client.level, customer_client.test_account
FROM customer_client
WHERE customer_client.manager = false
```

**Q2 Account settings (per account)**
```sql
SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone,
       customer.auto_tagging_enabled,
       customer.call_reporting_setting.call_reporting_enabled,
       customer.call_reporting_setting.call_conversion_reporting_enabled,
       customer.call_reporting_setting.call_conversion_action,
       customer.conversion_tracking_setting.conversion_tracking_status,
       customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled
FROM customer
```

**Q3 Campaigns + budgets**
```sql
SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status,
       campaign.primary_status, campaign.primary_status_reasons,
       campaign.advertising_channel_type, campaign.advertising_channel_sub_type,
       campaign.bidding_strategy_type, campaign.target_cpa.target_cpa_micros,
       campaign.maximize_conversions.target_cpa_micros, campaign.target_roas.target_roas,
       campaign.network_settings.target_google_search, campaign.network_settings.target_search_network,
       campaign.network_settings.target_content_network,
       campaign.geo_target_type_setting.positive_geo_target_type,
       campaign.geo_target_type_setting.negative_geo_target_type,
       campaign.start_date, campaign.end_date,
       campaign_budget.id, campaign_budget.amount_micros, campaign_budget.delivery_method,
       campaign_budget.explicitly_shared
FROM campaign
```
(Includes REMOVED so we can set `removed_at`.)

**Q4 Campaign targets and campaign-level negatives**
```sql
SELECT campaign.id, campaign_criterion.criterion_id, campaign_criterion.type,
       campaign_criterion.negative, campaign_criterion.status, campaign_criterion.bid_modifier,
       campaign_criterion.location.geo_target_constant,
       campaign_criterion.proximity.radius, campaign_criterion.proximity.radius_units,
       campaign_criterion.language.language_constant,
       campaign_criterion.ad_schedule.day_of_week,
       campaign_criterion.ad_schedule.start_hour, campaign_criterion.ad_schedule.start_minute,
       campaign_criterion.ad_schedule.end_hour, campaign_criterion.ad_schedule.end_minute,
       campaign_criterion.device.type,
       campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
FROM campaign_criterion
WHERE campaign_criterion.type IN ('LOCATION','PROXIMITY','LANGUAGE','AD_SCHEDULE','DEVICE','KEYWORD')
  AND campaign.status != 'REMOVED'
```
KEYWORD rows with `negative = true` go to `negatives` (level `campaign`); the rest go to `campaign_targets`.

**Q5 Geo names (for new geo constants only)**
```sql
SELECT geo_target_constant.resource_name, geo_target_constant.name,
       geo_target_constant.canonical_name, geo_target_constant.target_type,
       geo_target_constant.country_code
FROM geo_target_constant
WHERE geo_target_constant.resource_name IN (...)
```

**Q6 Campaign daily**
```sql
SELECT campaign.id, segments.date,
       metrics.impressions, metrics.clicks, metrics.cost_micros,
       metrics.conversions, metrics.conversions_value,
       metrics.all_conversions, metrics.all_conversions_value, metrics.view_through_conversions,
       metrics.phone_calls, metrics.phone_impressions,
       metrics.search_impression_share, metrics.search_budget_lost_impression_share,
       metrics.search_rank_lost_impression_share, metrics.search_top_impression_share,
       metrics.search_absolute_top_impression_share,
       metrics.top_impression_percentage, metrics.absolute_top_impression_percentage
FROM campaign
WHERE segments.date BETWEEN '{from}' AND '{to}'
```

**Q7 Ad groups**
```sql
SELECT campaign.id, ad_group.id, ad_group.name, ad_group.status, ad_group.type, ad_group.cpc_bid_micros
FROM ad_group
```

**Q8 Ad group daily**
```sql
SELECT campaign.id, ad_group.id, segments.date,
       metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
       metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value,
       metrics.phone_calls
FROM ad_group
WHERE segments.date BETWEEN '{from}' AND '{to}'
```

**Q9 Keywords and ad-group negatives (attributes, quality score, bid estimates)**
```sql
SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.negative,
       ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
       ad_group_criterion.status, ad_group_criterion.system_serving_status,
       ad_group_criterion.approval_status, ad_group_criterion.cpc_bid_micros,
       ad_group_criterion.effective_cpc_bid_micros, ad_group_criterion.final_urls,
       ad_group_criterion.quality_info.quality_score,
       ad_group_criterion.quality_info.creative_quality_score,
       ad_group_criterion.quality_info.post_click_quality_score,
       ad_group_criterion.quality_info.search_predicted_ctr,
       ad_group_criterion.position_estimates.first_page_cpc_micros,
       ad_group_criterion.position_estimates.top_of_page_cpc_micros,
       ad_group_criterion.position_estimates.first_position_cpc_micros
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'KEYWORD'
```

**Q10 Keyword daily**
```sql
SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id, segments.date,
       metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
       metrics.conversions_value, metrics.all_conversions, metrics.search_impression_share
FROM keyword_view
WHERE segments.date BETWEEN '{from}' AND '{to}'
```

**Q11-Q13 Shared negative lists**
```sql
SELECT shared_set.id, shared_set.name, shared_set.type, shared_set.status, shared_set.member_count
FROM shared_set
WHERE shared_set.type IN ('NEGATIVE_KEYWORDS', 'ACCOUNT_LEVEL_NEGATIVE_KEYWORDS')

SELECT shared_set.id, shared_criterion.criterion_id, shared_criterion.type,
       shared_criterion.keyword.text, shared_criterion.keyword.match_type
FROM shared_criterion
WHERE shared_set.type IN ('NEGATIVE_KEYWORDS', 'ACCOUNT_LEVEL_NEGATIVE_KEYWORDS')

SELECT campaign.id, shared_set.id, campaign_shared_set.status
FROM campaign_shared_set
WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
```
(`ACCOUNT_LEVEL_NEGATIVE_KEYWORDS` is kept only if v25 exposes it; checked in Phase 2.)

**Q14 Search terms**
```sql
SELECT campaign.id, ad_group.id, search_term_view.search_term, search_term_view.status,
       segments.keyword.ad_group_criterion, segments.keyword.info.text, segments.keyword.info.match_type,
       segments.search_term_match_type, segments.date,
       metrics.impressions, metrics.clicks, metrics.cost_micros,
       metrics.conversions, metrics.conversions_value, metrics.all_conversions
FROM search_term_view
WHERE segments.date BETWEEN '{from}' AND '{to}'
```

**Q15 Ads (RSA text, policy)**
```sql
SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status,
       ad_group_ad.ad_strength, ad_group_ad.ad.final_urls,
       ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
       ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2,
       ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status,
       ad_group_ad.policy_summary.policy_topic_entries
FROM ad_group_ad
```

**Q16 Ad daily**
```sql
SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, segments.date,
       metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM ad_group_ad
WHERE segments.date BETWEEN '{from}' AND '{to}'
```

**Q17 RSA asset performance labels**
```sql
SELECT ad_group.id, ad_group_ad.ad.id, asset.id, asset.text_asset.text,
       ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.performance_label,
       ad_group_ad_asset_view.pinned_field, ad_group_ad_asset_view.enabled,
       metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
FROM ad_group_ad_asset_view
WHERE segments.date DURING LAST_30_DAYS
```

**Q18 Assets / extensions (run for `customer_asset`, `campaign_asset`, `ad_group_asset`)**
```sql
SELECT campaign.id, campaign_asset.field_type, campaign_asset.status, campaign_asset.primary_status,
       asset.id, asset.type, asset.name, asset.final_urls,
       asset.call_asset.phone_number, asset.call_asset.country_code,
       asset.call_asset.call_conversion_reporting_state, asset.call_asset.call_conversion_action,
       asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2,
       asset.callout_asset.callout_text,
       asset.structured_snippet_asset.header, asset.structured_snippet_asset.values
FROM campaign_asset
WHERE campaign_asset.field_type IN ('CALL','SITELINK','CALLOUT','STRUCTURED_SNIPPET','LOCATION')
```
Location assets come from a Business Profile asset set; if they do not appear here, they are read through `asset_set` / `customer_asset_set` (checked in Phase 2). Q18b adds `segments.date` + metrics to feed `asset_daily`.

**Q19 Conversion actions**
```sql
SELECT conversion_action.id, conversion_action.name, conversion_action.category, conversion_action.type,
       conversion_action.origin, conversion_action.status, conversion_action.counting_type,
       conversion_action.primary_for_goal, conversion_action.include_in_conversions_metric,
       conversion_action.value_settings.default_value, conversion_action.value_settings.always_use_default_value,
       conversion_action.click_through_lookback_window_days,
       conversion_action.phone_call_duration_seconds,
       conversion_action.attribution_model_settings.attribution_model
FROM conversion_action
```

**Q20 Conversions by action (feeds last conversion date)**
```sql
SELECT campaign.id, segments.conversion_action, segments.date,
       metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value
FROM campaign
WHERE segments.date BETWEEN '{from}' AND '{to}'
```

**Q21 Calls**
```sql
SELECT call_view.resource_name, campaign.id, ad_group.id,
       call_view.start_call_date_time, call_view.end_call_date_time, call_view.call_duration_seconds,
       call_view.call_status, call_view.type, call_view.call_tracking_display_location
FROM call_view
WHERE call_view.start_call_date_time >= '{from} 00:00:00'
```
`caller_area_code` and `caller_country_code` are deliberately not selected.

**Q22 Hour of day / Q23 Device**
```sql
SELECT campaign.id, segments.date, segments.hour, segments.day_of_week,
       metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.phone_calls
FROM campaign
WHERE segments.date BETWEEN '{from}' AND '{to}'

SELECT campaign.id, segments.date, segments.device,
       metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
FROM campaign
WHERE segments.date BETWEEN '{from}' AND '{to}'
```

**Q24 Geo (presence vs interest)**
```sql
SELECT campaign.id, segments.date, geographic_view.location_type, geographic_view.country_criterion_id,
       segments.geo_target_most_specific_location,
       metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
FROM geographic_view
WHERE segments.date BETWEEN '{from}' AND '{to}'
```

**Q25 Recommendations** (reference query, extended; `impact` may be missing and defaults to `{}`)
```sql
SELECT recommendation.resource_name, recommendation.type, recommendation.campaign,
       recommendation.ad_group, recommendation.dismissed, recommendation.impact
FROM recommendation
```

**Q26 Change history** (API allows only the last 30 days and requires a LIMIT)
```sql
SELECT change_event.resource_name, change_event.change_date_time, change_event.change_resource_type,
       change_event.change_resource_name, change_event.client_type, change_event.user_email,
       change_event.resource_change_operation, change_event.changed_fields,
       change_event.campaign, change_event.ad_group
FROM change_event
WHERE change_event.change_date_time >= '{from}'
ORDER BY change_event.change_date_time DESC
LIMIT 10000
```

**Q27 Keyword volume (Google)**
`POST customers/{id}:generateKeywordHistoricalMetrics` with the account's distinct positive keyword texts,
`geoTargetConstants` from the campaign's location targets, `language` from its language target,
`keywordPlanNetwork: GOOGLE_SEARCH`, `historicalMetricsOptions.includeAverageCpc: true`.
Up to 10,000 keywords per call. Not a mutate. Stored in `keyword_volume` with `source = 'google_kp'`.

---

## 7. n8n workflows

All webhooks: `POST`, path prefix `/ff/`, `responseMode: responseNode`, CORS limited to the Netlify origin,
then the Auth check block (input validation, JWT, role). All Supabase writes use the FF Supabase credential (service role).
Each reference workflow maps to one FF workflow of the same shape.

| Workflow | Reference | Trigger | Allowed roles | Google Ads | Status |
|---|---|---|---|---|---|
| `ff-whoami` | new | `/ff/whoami` - returns the caller's role; the Auth check block's reference copy and test target | any profile | none | Phase 1 |
| `ff-sync` | `sync-metrics` | Schedule daily 06:00 + weekly Sunday 07:00 (90-day mode) + `/ff/sync-now` | ff_staff, rob_admin | read | Phase 2 |
| `ff-geo-target-suggest` | `geo-target-suggest` | `/ff/geo-target-suggest` | ff_staff, rob_admin | `geoTargetConstants:suggest` (read) | Phase 3 |
| `ff-campaign-chat` | `campaign-chat` | `/ff/campaign-chat` - actions `send`, `reset`, `delete_message`, `dismiss_action` | ff_staff, rob_admin | none | Phase 3 |
| `ff-client-message` | `client-message-to-draft` | `/ff/client-message` - client posts a suggestion; AI drafts a reply into `message_drafts` | client_viewer (own client), ff_staff, rob_admin | none | Phase 3 (see 12) |
| `ff-send-reply` | `send-reply` | `/ff/send-reply` - agency approves a draft; the reply text is posted. A `proposed_action` in it goes to the Phase 6 apply path | ff_staff, rob_admin (action part: rob_admin) | none until Phase 6 | Phase 3 |
| `ff-search-term-triage` | new | `/ff/search-term-triage` - keep / block / ask_rob | ff_staff, rob_admin | none (block = decision only until Phase 6) | Phase 3 |
| `ff-recommendation-hide` | new | `/ff/recommendation-hide` - hides a row on the dashboard only | ff_staff, rob_admin | none | Phase 3 |
| `ff-client-admin` | new | `/ff/client-admin` - `create_client`, `update_client`, `archive_client`, `assign_account`, `unassign_account`, `create_login`, `reset_password`, `disable_login`, `enable_login` | ff_staff, rob_admin | none | Phase 4 |
| `ff-audit` | new | `/ff/audit` (generate) + `/ff/audit-review` (mark reviewed) | generate: ff_staff, rob_admin; review: rob_admin | read | Phase 5 |
| `ff-build-campaign` | `build-campaign` | `/ff/build-campaign` | rob_admin | write, PAUSED only | Inactive until Phase 6 |
| `ff-apply-campaign-action` | `apply-campaign-action` | `/ff/apply-campaign-action` | rob_admin | write | Inactive until Phase 6 |
| `ff-delete-campaign` | `delete-campaign` | `/ff/delete-campaign` | rob_admin | write (remove) | Inactive until Phase 6 |
| `ff-dataforseo` | new | Weekly schedule + `/ff/dataforseo-refresh` | ff_staff, rob_admin | none | Phase 7 |
| `ff-weekly-report` | new (PDF task 8) | Monday 08:00 + `/ff/weekly-report` - fills `weekly_stats` and `tracking_health` from `ff_weekly_report()`, counts GHL leads tagged "from google ads" (count only), writes one row to the client's Google Sheet, Slack note to Rob (schedule only, or `slack: true`). Keeps no execution data (the GHL answer can hold a contact) | ff_staff, rob_admin | none | Built 2026-10-02 |
| `ff-case-match` | new (PDF task 6) | `/ff/case-match` - check (validateOnly) or upload the no-name monthly case list as offline conversions: click ids, hashed email/phone (enhanced conversions for leads), call conversions. Counts to `case_match_runs`, summaries to `write_log`. Keeps no execution data | check: ff_staff, rob_admin; upload: rob_admin | write (uploads) | Built 2026-10-05 |
| `ff-website-check` | new (PDF tasks 3, 7) | Daily 06:45 + `/ff/website-check` - reads each client's public pages (website on Edit client + ad landing pages, no login): FF script and settings, Google tag / GTM, GHL or lead form, online checkout, platform. Yes/no answers and tag ids only, to `website_checks`; then fills in by itself the client type (online payment found = online cremation, unless set by hand), website and phone when empty, and links the GHL sub-account by name / website / phone | ff_staff, rob_admin | none | Built 2026-10-07 |
| `ff-search-triage` | new (PDF task 5) | Daily 07:30 + `/ff/search-triage` - sorts new search terms (last 7 days, not name-filtered) into keep / block / ask Rob: FF blocked words, own name and competitors by rule, the rest by the AI, unclear to Rob. Saves to `search_term_triage`, never overwrites a decision | ff_staff, rob_admin | none | Built 2026-10-06 |
| `ff-gaql` | new (PDF task 1) | `/ff/gaql` - one read-only GAQL query for Claude Code (`scripts/ff.mjs gaql`) and staff. Caller phone fields refused; search terms name-filtered; no execution data | ff_staff, rob_admin | none | Built 2026-10-05 |
| `ff-ghl-setup` | new (PDF task 3) | `/ff/ghl-setup` - `list_locations` (sub-account picker on Edit client), `check` / `setup`: the FF GHL key reaches the client's location; creates the contact fields gclid, gbraid, wbraid, utm_* and the tag "from google ads" if missing. Nothing else in GHL changes | ff_staff, rob_admin | none | Built 2026-10-02 |

Carried over from the reference notes: explicit response modes; `.first()` for singletons; key-based matching;
`alwaysOutputData` on empty-able reads; `executeOnce` on table-wide reads; `onError: continueRegularOutput` on the
AI agent with a guard for `{output: null}`; suggestion dedupe (no repeat within 24h or while an actionable one is open);
removal treats `OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE` as success; the Supabase write-back after an applied
budget or status change; upserts via PostgREST `on_conflict`.

**AI prompts (chat, client message, proactive):**
- Inputs are numbers, campaign/ad group names, recommendation types and filtered search terms only.
- Client message text goes through the same name filter as search terms before it reaches the model; the system
  prompt also tells the model never to repeat personal names and to use calm, plain wording, plain hyphens, no emoji.
- `proposed_action` keeps the reference's three types (`update_daily_budget`, `pause_campaign`, `resume_campaign`).
  The UI shows Confirm & Apply only to `rob_admin`, and `ff-apply-campaign-action` checks the role again.

**Phase 6 write rules:**
- Every mutate sends `validateOnly: true` first, then the real call.
- `ff-build-campaign` creates campaign, ad groups, ads and assets with status PAUSED. No path sets ENABLED except
  `ff-apply-campaign-action` with `resume_campaign`, which is `rob_admin` only.
- A write to an account where `is_test_account = false` is refused unless `clients.writes_enabled = true`,
  which only `rob_admin` can set, after the same operation has succeeded on the test account (recorded in `write_log`).
- Positive keywords: PHRASE or EXACT only, 5-15 per ad group (validated before any call). Max 2 RSAs per ad group.
- The reference's generic 149-term list is replaced by the FF shared list "FF - Funeral universal negatives"
  (2026-10-06; the older name "FF Universal Negatives" is still recognised):
  - the words live in Supabase `universal_negatives` (themes: obituaries, jobs, products, writing, etiquette, free),
    shown on the client page (Blocked searches > Show the word list) and read by n8n
  - each account's list also holds the client's own name (`own_brand_terms`, else the client name) and
    `clients.competitor_terms`, phrase match
  - Rob's one click per account (client page > Blocked searches) creates the list if missing, adds missing words and
    attaches it to every search campaign; ff-build-campaign attaches it to new campaigns
  - every Monday 07:30 `ff-search-triage` sorts new search terms into keep / block / ask Rob (FF words and names by
    rule, the rest by the AI, unclear to Rob) into `search_term_triage` (`decided_how` = person / rule / ai). Adding
    the negatives in Google Ads stays Rob's click (Search Terms > Pick all marked Block > Add as negative).
- Every write is logged to `write_log` and posted to Slack.

---

## 8. Page map (dashboard)

Look: same as the reference (slate palette, white rounded cards, uppercase table headers, pill date-range buttons),
plus a light/dark/system switcher in the header. Mobile: tables scroll inside their card, KPI grid goes to 2 columns,
tabs scroll sideways. Print: `print.css` hides nav, buttons and the chat input; shows the client, account, date range
and print date at the top; avoids breaks inside cards and table rows; forces the light theme.

| Route | Who | Content | Actions (hidden when not allowed) |
|---|---|---|---|
| `/login` | all | Email + password | Sign in |
| `/account` | all | Own email, role | Change password, sign out |
| `/` | all | Agency users go to `/dashboard`; a `client_viewer` goes to `/dashboard/clients/<own id>` | - |
| `/dashboard` | agency | Totals row (cost, conversions, calls 90s+, cost/conv, conv value) for the chosen range; client table (as the reference: campaigns, accounts, status, cost, conv value, ROAS or cost/conv); badge "N unassigned accounts"; last sync time and status | Sync Now, + New Client, Edit, Archive |
| `/dashboard/accounts` | agency | All accounts, including Unassigned, with the client each belongs to | Assign to client, toggle sync |
| `/dashboard/clients/:clientId` | agency, own client | Client header; date range (7 / 30 / 90 / custom); accounts table; campaigns table (status, budget, cost, conversions, cost/conv, IS); tracking health summary | Agency: Edit Client, Users, Audit, + Add Campaign (Phase 6) |
| `/dashboard/clients/:clientId/users` | agency | Client logins: email, status, created | Create login, Reset password, Disable/Enable |
| `/dashboard/clients/:clientId/audit` | agency | Latest audit rendered from Markdown, with history | Generate (staff), Mark reviewed (Rob) |
| `/dashboard/clients/:clientId/campaigns/:campaignId` | agency, own client | KPI cards (cost, conversions, cost/conv, conv value, ROAS, impressions, clicks, CTR, avg CPC, search IS) + tabs below | see tabs |
| `/settings` | agency | Sync runs log and per-account errors, API version, Slack test. **No secrets.** | Sync Now |

Campaign tabs:

| Tab | Content | Client sees |
|---|---|---|
| Campaign Assistant | Reference chat. Confirm & Apply shown to `rob_admin` only, and disabled until Phase 6 | No |
| Performance | Reference trend charts plus conversions, calls 90s+ and IS by day | Yes |
| Keywords | Text, match type, status, QS (+3 parts), impressions, clicks, CTR, CPC, cost, conversions, cost/conv, Google monthly volume, first-page / top-of-page bid; sort, filter, CSV | Yes |
| Search Terms | Term (after name filter), matched keyword, match type, metrics, Google status, "Already negative", triage decision; sort, filter, CSV | Yes, no triage controls |
| Negatives | Campaign + ad group + shared-list negatives in one table: text, match type, level, list name; CSV | Yes |
| Ads & Assets | RSAs with each headline/description and its performance label, pinning, ad strength, approval/policy; extensions (call, sitelink, callout, snippet, location) with status and metrics | Yes |
| Time & Device | Day-of-week x hour heatmap (metric picker: clicks, cost, conversions, calls, cost/conv); device split; presence vs interest geo split | Yes |
| Conversions | Conversion actions with category, counting, value, call duration setting, last conversion date, health flag; account checks (auto-tagging, call reporting) | Yes |
| Recommendations | Reference list, extended with type-specific impact where Google gives it | Yes |
| Client Suggestions | Reference thread. Client can post (if approved in 12); agency sees AI drafts | Yes (own thread, no drafts) |
| Change History | Change events for the campaign | No |

Webhook calls go through one helper, `web/src/lib/n8n.ts`: it takes the current session token, POSTs to
`VITE_N8N_BASE_URL + path`, and shows 401/403 errors in plain words. Data reads use the typed Supabase client
and the views/RPCs in 4.6.

---

## 9. Everything the reference hardcodes (and the FF replacement)

| # | Where | Hardcoded value | FF replacement |
|---|---|---|---|
| 1 | `sync-metrics.json` (Search campaign metrics setup, Get distinct customers, Get clients pending discovery), `build-campaign.json` Prepare context, `send-reply.json`, `apply-campaign-action.json`, `delete-campaign.json` | `DIRECT_ACCESS_CUSTOMER_IDS = ['3534195221']` | `ad_accounts.login_customer_id` |
| 2 | `sync-metrics.json` Upsert metrics row, Upsert metrics row (backfill) | `https://pbeqzrpyxnglppqofeqq.supabase.co` | Config node `SUPABASE_URL` for the new FF project |
| 3 | `campaign-chat.json`, `client-message-to-draft.json`, `sync-metrics.json` | OpenAI credential "Manam- OpenAi account" (`fj3WhBV98VkK9qr3`), model `gpt-5-mini` | FF-owned LLM credential; model in config |
| 4 | Every workflow | Supabase credential "Supabase Google Ads" (`gW3hdy107B2DtcxQ`) | FF Supabase credential (service role) |
| 5 | Every Google Ads URL (~20) | `googleads.googleapis.com/v25/` | `API_VERSION` in each workflow's Config node |
| 6 | `build-campaign.json` Notify node | `https://ans-google-ads.netlify.app` | `DASHBOARD_URL` config |
| 7 | `schema.sql` + `/settings` page | `google_ads_settings` secrets readable/editable by any login | 3.5 |
| 8 | `schema.sql` seed | AniyaNetworks client, `manam.parves@gmail.com`, customer `3534195221`, campaign/ad group resource names | No seed in the FF project; `supabase/seed.sql` is local-only fake data |
| 9 | `sync-metrics.json` Create client for discovered account / Filter unknown accounts | `googleads-<id>@discovered.local` placeholder clients | Unassigned accounts (`ad_accounts.client_id = null`) |
| 10 | `build-campaign.json` Build negatives body; `code/add_shared_negative_list.py` | Generic 149-term negative list | FF funeral list (section 7) |
| 11 | `build-campaign.json` Build RSA body | Generic placeholder ad copy | Copy drafted per client, approved by Rob (Phase 6) |
| 12 | `build-campaign.json` Build campaign body | Defaults "Maximize Clicks", "24 Hours", English | Campaign templates A (at-need, 24/7) and C (preplanning, office hours) from the SOP |
| 13 | `sync-metrics.json` Schedule Trigger | 06:00 server time | 06:00 in the FF time zone, set in workflow settings |
| 14 | Frontend `currency` formatters | `USD` | Account `currency_code` |
| 15 | `site/index.html` | Title "AniyaNetworks Agency Dashboard" | "Funeral Futurist - Ads Dashboard" |
| 16 | Frontend env | 9 separate `VITE_N8N_*_WEBHOOK_URL` values, webhooks with no auth | `VITE_N8N_BASE_URL` + fixed paths, JWT on every call |
| 17 | `schema.sql` | `anon` insert on `clients`/`campaigns`; `/intake` public page; `/client/:clientId` magic link | Removed |
| 18 | Frontend | Direct writes: `CampaignChat` (delete, reset, dismiss), `IntakeForm` (insert client, campaign), `DashboardPage` (delete client), `EditClientModal` (update client), `SettingsPage` (update secrets), `MessageThread` (update message) | n8n webhooks |
| 19 | `sync-metrics.json` Delete removed campaign | Hard delete with cascade | Soft `removed_at` |
| 20 | `sync-metrics.json` Delete existing open recommendations | Delete-then-create | Upsert + `expired` |
| 21 | `ANS-Google-Ads/SETUP.md` | Personal MCC naming, personal OAuth test user | FF MCC, FF Cloud project, FF OAuth app |

---

## 10. Environment and config

`.env.example` (web, Netlify env vars):
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_N8N_BASE_URL=            # e.g. https://n8n.<ff-domain>/webhook
VITE_APP_ENV=development      # shows a "TEST" badge when not production
```

Local only (never in the web build): `SUPABASE_SERVICE_ROLE_KEY` for `scripts/` tests, `SUPABASE_DB_URL` for migrations.

n8n credentials (FF instance): Supabase (service role), Google Ads OAuth2 + developer token (3.5 option A),
LLM provider, Slack incoming webhook, DataForSEO (Phase 7).
n8n config node (non-secret): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (for `/auth/v1/user`), `MCC_ID`, `TEST_ACCOUNT_ID`,
`API_VERSION`, `DASHBOARD_URL`, `ALLOWED_ORIGIN`, `FF_TIMEZONE`. If the FF instance allows n8n Variables, these move there.

Netlify: `netlify.toml` with `base = "web"`, SPA redirect, security headers (CSP allowing only the Supabase and n8n origins, `X-Frame-Options: DENY`).

---

## 11. Phases (superseded)

Superseded 2026-09-30: everything below was built in one pass. Kept as the list of acceptance checks.

| Phase | Build | Done when |
|---|---|---|
| 0 | This plan + CLAUDE.md | Manam approves |
| 1 Foundation | Repo layout, migrations 0001-0003 (all tables, views, helpers, RLS, grants), pgTAP RLS tests, `web/` scaffold ported from the reference (login, account, protected routes, role-aware nav, theme switcher, print CSS base), `netlify.toml`, `.env.example`, `ff-whoami` with the Auth check block, credential spike (3.5) | `test-db-local.mjs` green; login works for each role against the FF dev project; `test-auth-block.mjs` green (401/403/200) |
| 2 Read-only sync | `ff-sync`, all queries Q1-Q27, name filter, tracking health, Slack alert, `check-n8n.mjs` | Live sync against the FF MCC fills every table; one broken account does not stop others; zero `GOOGLE_ADS_API` change events; checker passes |
| 3 Dashboard | Agency home, accounts, client detail, campaign detail with all tabs, CSV export, date ranges, print, mobile; `ff-campaign-chat`, `ff-client-message`, `ff-send-reply`, `ff-geo-target-suggest`, triage, recommendation hide | Screens match the reference style in light and dark; prints cleanly; works at 375px wide; no Supabase writes from the browser (grep check) |
| 4 Client logins | `ff-client-admin`, Users page, Unassigned accounts assignment, `rls-e2e.test.ts` | Viewer A cannot see B through PostgREST or webhooks; disabled login cannot sign in |
| 5 Audit | `ff-audit`: campaigns, settings, conversion tracking, 90 days of search terms (filtered), negatives, issues found; saved to `audits` + `/audits/<client-slug>.md`; audit page with Mark reviewed | Rob has read and marked the pilot audit reviewed |
| 6 Writes | Enable `ff-build-campaign`, `ff-apply-campaign-action`, `ff-delete-campaign` on the test account; role gating; PAUSED-only; `validateOnly` first; `write_log`; FF negative list | Every operation succeeds on the test account and is logged; `ff_staff` gets 403; nothing is created ENABLED |
| 7 DataForSEO | `ff-dataforseo`: volume, CPC, competition, related keywords for positives, negatives and filtered search terms; cached in `keyword_volume`; shown in Keywords (and a related-keywords list) | Cached values show in the Keywords tab; repeat runs within the cache period make no DataForSEO calls |

---

## 12. Open questions

For Rob:
1. **Search term name filter (5.4).** OK to replace any name-bearing term with `[name removed - <intent>]` before storage, and accept that a few harmless terms get removed too?
2. **Client Suggestions.** May a `client_viewer` post messages in the Client Suggestions thread? This writes a row, via n8n. The alternative is pure read-only for clients, which drops the tab for them.
3. **Removed campaigns.** Keep their history (soft remove) rather than deleting it, as planned?
4. From the PDF, still open: pilots (McCall Gardens for Process 1; who for Process 2), who collects the monthly case list, who runs case match after handoff, and whether the Netlify and Supabase accounts are FF-owned from day one. 90 seconds is confirmed as the call threshold (2026-10-05).

For Manam:
5. **LLM provider and model** for the FF credential (the reference uses OpenAI `gpt-5-mini`).
6. ~~PDF tasks outside Phases 1-7~~ - all built (2026-10-02 and 2026-10-05). Still for Rob: OK to let ff-case-match upload (a fourth Google Ads write workflow, same guards); who collects the case lists; the Process 2 pilot and its checkout.
7. **FF n8n instance:** is `$env` / n8n Variables available, and can the HTTP Request node use a Google Ads OAuth2 credential there? This decides 3.5 option A or B.
8. **FF time zone** for the 06:00 schedule and for "yesterday" in alerts.
9. **Google Ads test account:** does FF already have a test manager account + test client account for Phase 6?
10. OK to move the root `n8n/` reference exports to `reference/n8n-ans/` in Phase 1?
