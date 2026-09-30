# CLAUDE.md - Funeral Futurist (FF) Google Ads Dashboard

Read this before every task. `PLAN.md` holds the full design (schema, workflows, GAQL, pages).

## What this is

A multi-tenant Google Ads analytics dashboard for Funeral Futurist (FF), a marketing agency for
funeral homes and cremation providers. Rob (FF) approves. Manam builds.

- `web/` - React + Vite + TypeScript + Tailwind dashboard, hosted on Netlify.
- `supabase/` - migrations, seed, RLS tests. FF-owned Supabase project.
- `n8n/` - FF n8n workflow exports (`ff-*.json`). The whole data pipeline and every write.
- `audits/` - read-only audit reports per pilot client (Markdown).
- `ANS-Google-Ads/` and `reference/` - the reference app. Read-only. Never commit, never copy IDs or credentials from it.

## Data-flow rule (do not break)

```
Google Ads / DataForSEO -> n8n -> Supabase -> Netlify dashboard (read only)
Dashboard button -> n8n webhook (JWT + role check) -> Google Ads and/or Supabase
```

- The dashboard READS business data from Supabase with the anon key + the user's JWT. RLS decides what it sees.
- The dashboard never writes business data to Supabase, and never calls Google Ads or DataForSEO.
  Its only direct Supabase calls are auth: sign in, sign out, change own password.
- Every action (sync, client admin, chat, build, apply, delete, triage) is a POST to an n8n webhook
  with `Authorization: Bearer <supabase access token>`.
- n8n writes to Supabase with the service role key, held only in n8n credentials.
- No Supabase Edge Functions or pg_cron unless PLAN.md is updated first with the reason.

## Webhook rules (every n8n webhook)

1. `responseMode` set explicitly (use `responseNode` so 400/401/403 can be returned). Never rely on the default.
2. Validate input shape first (UUIDs, enums, lengths).
3. Run the Auth check block (copied into every webhook workflow by the build; reference copy in `ff-whoami`):
   `GET <SUPABASE_URL>/auth/v1/user` with the token, load `profiles` by `user_id`, reject if missing, disabled,
   or role not allowed. `rob_admin`-only actions check that exact role.
4. CORS limited to the Netlify origin(s).

## Hard rules (Rob's SOP - non-negotiable)

1. **FF owns everything.** FF accounts, FF credentials, FF repo. No personal accounts. No IDs,
   URLs or credential names from the reference app (see PLAN.md section 9).
2. **Google Ads writes only in three workflows**: ff-build-campaign, ff-apply-campaign-action,
   ff-delete-campaign. Every other workflow may only call `googleAds:search`, `googleAds:searchStream`,
   `:generateKeywordHistoricalMetrics` and `geoTargetConstants:suggest` (checked by `scripts/check-n8n.mjs`).
3. **Every write:** `rob_admin` only; a `validateOnly` call first; built PAUSED; allowed on a Google Ads test
   account, and on a live account only after `rob_admin` turns `clients.writes_enabled` on (test first);
   every attempt logged to `write_log`.
4. **No personal names.** No family or deceased names in URLs, tags, logs, table columns, AI prompts
   or audit files. Search terms pass the name filter before storage (PLAN.md section 5.4).
   Case lists are never stored in Supabase - counts only - and are deleted after upload.
   Never store caller phone numbers or caller area codes.
5. **Secrets stay out of code.** Google Ads values in Supabase `private.google_ads_secrets` (entered by Rob on the
   Settings page, readable only by n8n); everything else in n8n credentials (PLAN.md 3.5). Never in code, workflow
   JSON, public tables or the browser. The service role key never reaches the browser.
6. **Calm tone.** Generated copy uses plain hyphens and no emoji. This applies to UI text, AI prompts, Slack notes and audits.
7. **No call recording, whisper or phone menu.** At-need calls ring straight through.

## Roles

| Role | Can do |
|---|---|
| `rob_admin` | Everything, including approving/applying any Google Ads write |
| `ff_staff` | View all clients, manage clients, accounts and client logins, trigger sync. No enable/budget/bid changes. |
| `client_viewer` | Read-only, rows for its own `client_id` only. No Settings, Sync, Delete, Confirm & Apply. |

## Database conventions

- RLS enabled on every table. `authenticated` gets SELECT policies only; no INSERT/UPDATE/DELETE policies
  on business tables, and those privileges are revoked. `anon` gets nothing.
- Client isolation is keyed on `customer_id` -> `ad_accounts.client_id` via `app.can_read_customer()`.
- Views are `with (security_invoker = true)`, otherwise they bypass RLS.
- Upsert on natural keys (PostgREST `on_conflict` + `Prefer: resolution=merge-duplicates`). No delete-then-create.
  Things that disappear in Google Ads are soft-marked (`removed_at`), not deleted.
- Every synced row has `synced_at`. Money is stored as `*_micros bigint` plus the account `currency_code`.
- Schema changes go in a new migration. Never edit an applied migration.

## n8n lessons from the reference (do not reintroduce)

- Refer to singleton upstream nodes with `.first()`, never `.item`, once a Code node has made new items.
- Match results back to their source by a real key (customer id, campaign id), never by array index.
- `alwaysOutputData: true` on any read that can legitimately return zero rows.
- `executeOnce: true` on nodes that do not need per-item context.
- Code nodes run once for all items; native nodes run once per item. Know which one you are in.
- Handle a missing `recommendation.impact` (default to zero).
- `login-customer-id` header is omitted (not empty) when `ad_accounts.login_customer_id` is null.
- One account failing must not stop the others (per-account Loop Over Items, errors recorded in `sync_run_accounts`).
- n8n workflows keep the reference's set and flow, one self-contained file each (no sub-workflows).
- Put a DB unique constraint behind every "insert if not exists".

## Working agreement

- No phases: Manam asked for everything to be built at once (2026-09-30).
- n8n workflows are generated: edit `n8n/src/**` or `scripts/build-n8n.mjs`, then run
  `node scripts/build-n8n.mjs && node scripts/check-n8n.mjs && node scripts/test-sync-code.mjs && node scripts/test-workflow-code.mjs`.
  Never hand-edit `n8n/ff-*.json` (except `ff-whoami.json`, the Auth check block's reference copy).
- Commit only when asked.
- Match the reference UI's look (slate palette, rounded cards, same table style), plus dark/light theme.
- Every page must print cleanly and work at phone width.
