# Funeral Futurist - Google Ads Dashboard

Multi-tenant Google Ads reporting and management for FF and its funeral home and cremation clients.
Design: [PLAN.md](PLAN.md). Rules for anyone (or any Claude session) working here: [CLAUDE.md](CLAUDE.md).

```
Google Ads / DataForSEO -> n8n -> Supabase -> Netlify dashboard (read only)
Dashboard button -> n8n webhook (JWT + role check) -> Google Ads and/or Supabase
```

| Folder | What |
|---|---|
| `web/` | React + Vite + TypeScript dashboard (Netlify) |
| `supabase/` | Migrations and RLS tests |
| `n8n/` | 16 n8n workflow exports (`ff-*.json`), generated from `n8n/src/` |
| `scripts/` | n8n build and checks, Code node tests, DB and auth tests |
| `audits/` | Audit reports downloaded from the dashboard (`<client-slug>.md`) |
| `docs/` | `tracking-setup.md` - calls 90s+, the GHL preplanning form, the website script and the weekly report, step by step |

## 1. Supabase (FF project)

1. Run the migrations in `supabase/migrations/` in filename order (SQL editor, or `npx supabase db push`).
   Each one runs once. If you ran an early copy of migration 7 that created `private.secrets`, remove it:
   ```sql
   drop function if exists public.ff_secrets();
   drop table if exists private.secrets;
   drop schema if exists private;
   ```
2. Authentication > Providers > Email: turn off "Allow new users to sign up". Minimum password length 10.
3. First `rob_admin`: Authentication > Users > Add user (auto-confirm), then in the SQL editor:
   ```sql
   insert into public.profiles (user_id, email, role)
   select id, email, 'rob_admin' from auth.users where email = '<rob-email>';
   ```
   Every other login is created from the dashboard.
4. Optional: `psql "<connection string>" -f supabase/tests/rls.test.sql` - every line should start with `ok`.

## 2. n8n (FF instance)

### Credentials (Settings > Credentials), exact names

| Name | Type | Value |
|---|---|---|
| FF Supabase (service role) | Supabase API | FF project URL + service role key |
| FF OpenAI | OpenAI | FF-owned API key |
| FF Slack | Slack API | Bot token (optional - only for Slack notes) |
| FF DataForSEO | Basic Auth | DataForSEO API login + API password |
| FF GHL | Header Auth | Name `Authorization`, value `Bearer <GHL agency-level private integration key>` (scopes in docs/tracking-setup.md). Also set `GHL_COMPANY_ID` in the Config of ff-weekly-report and ff-ghl-setup |
| FF Google Sheets | Google Sheets OAuth2 API | FF Google account that can edit the client Sheets |

### Google Ads connection (dashboard, not n8n)

Google Ads values are **not** n8n credentials. After the workflows are imported and active, Rob opens the
dashboard **Settings > Google Ads API connection** and enters the developer token, MCC ID, OAuth Client ID and
Client secret, then clicks **Connect with Google** (this creates the refresh token) and **Test connection**.
The values are stored in Supabase `private.google_ads_secrets`: only n8n can read them; the page only shows
"set / not set". For Connect with Google, add `<dashboard URL>/settings/google-callback` to the OAuth client's
Authorized redirect URIs (Web application client) and set the consent screen to "In production".
`scripts/get-google-refresh-token.mjs` is a fallback if Connect with Google cannot be used.

### Workflows

Import each file in `n8n/` (Workflows > Import from File, or open the file, copy everything, paste on an empty canvas).
In every workflow:
- open **Config** and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` (ff-sync also optional `SLACK_CHANNEL`);
- open any node showing a credential warning and pick the credential with the same name;
- on the **Webhook** node, set Allowed Origins to the Netlify URL;
- Workflow settings > Timezone: FF's time zone;
- ff-weekly-report: also `SLACK_CHANNEL` (Rob's channel) and `DASHBOARD_URL` in Config;
- activate it.

| Workflow | What | Who |
|---|---|---|
| ff-whoami | Connection check (Settings page) | everyone |
| ff-sync | Daily 06:00 (30 days), Sunday (90 days), Sync Now. MCC discovery, 27 read-only reports per account, geo names, Slack note, AI suggestions | schedule; staff for Sync Now |
| ff-geo-target-suggest | Location search for the builder | staff |
| ff-campaign-chat | Campaign Assistant | staff |
| ff-client-message | Client suggestions + AI draft | clients (own client), staff |
| ff-send-reply | Send the edited reply | staff |
| ff-apply-campaign-action | Confirm & Apply (budget / pause / resume) | Rob |
| ff-build-campaign | Drafts (staff), build PAUSED campaign (Rob) | staff / Rob |
| ff-delete-campaign | Remove a campaign | Rob |
| ff-client-admin | Clients, account assignment, logins, write switch | staff (Rob for staff logins and writes) |
| ff-review-actions | Search term triage, hide recommendations | staff |
| ff-audit | Read-only audit; Rob marks reviewed | staff / Rob |
| ff-dataforseo | Weekly keyword volume, CPC, related keywords (DataForSEO + Google Keyword Planner) | schedule; staff |
| ff-google-ads-settings | Save Google Ads values, Connect with Google, Test connection (Settings page) | Rob; staff can test |
| ff-weekly-report | Monday 08:00: weekly_stats + tracking_health, GHL lead count, client Google Sheet row, Slack note to Rob. Also "Run for last week" on the client page (no Slack) | schedule; staff |
| ff-ghl-setup | Pick from GHL (Edit client: lists the sub-accounts), Check GHL / Set up GHL fields (client page): gclid, gbraid, wbraid, utm_* fields and the "from google ads" tag | staff |

**Google Ads writes** (build, apply, remove): Rob only, `validateOnly` first, created PAUSED, logged in `write_log`.
They run on a Google Ads **test account** at any time; on a live account only after Rob turns
"Google Ads writes" on for that client (client page).

## 3. Netlify

Site base directory `web` (from `netlify.toml`). Environment variables: `VITE_SUPABASE_URL`,
`VITE_SUPABASE_ANON_KEY`, `VITE_N8N_BASE_URL` (e.g. `https://n8n.example.com/webhook`), `VITE_APP_ENV=production`.
Nothing else - no service keys, no Google secrets.

## Development

```bash
node scripts/build-n8n.mjs          # regenerate n8n/*.json from n8n/src
node scripts/check-n8n.mjs          # export rules (read-only calls, auth block, credentials, no reference IDs)
node scripts/test-sync-code.mjs     # ff-sync Code nodes against fake Google Ads responses
node scripts/test-workflow-code.mjs # webhook workflow Code nodes (build rules, write guards, admin, audit, DataForSEO)
node scripts/test-db-local.mjs      # migrations + RLS tests on a local Postgres (LOCAL_PG_URL in .env)

cd web && cp .env.example .env.local && npm install && npm run dev
```

Never hand-edit `n8n/ff-*.json`; change `n8n/src/` or `scripts/build-n8n.mjs` and rebuild.
