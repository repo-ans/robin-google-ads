---
name: ff-audit
description: Read-only Google Ads audit of one FF client account - generates the audit from synced data, checks it live, and saves audits/<slug>.md for Rob. Use when asked to audit a client, review an account, or prepare milestone M0.
---

# /ff-audit - read-only account audit

Look, never change. Nothing in this skill writes to Google Ads.

## Rules (Rob's SOP, always)
- Read only. If a fix is needed, list it for Rob - do not make it.
- No family or deceased names anywhere: not in the audit, not in chat. Search terms come name-filtered; keep "[name removed - ...]" as it is.
- Calm, plain tone. Plain hyphens (-), no emoji.
- All access goes through `node scripts/ff.mjs` (your own FF login). Never ask for or use a service role key or Google Ads secret.

## Steps
1. Find the client and account:
   `node scripts/ff.mjs clients` - note `id`, `name` and the `customer_id` of the account to audit.
2. Make sure the data is fresh: check `last_synced_at`. If older than a day, ask before starting a sync
   (`node scripts/ff.mjs call ff/sync-now '{"customer_id":"<10 digits>"}'`, then wait a few minutes).
3. Generate the audit (writes a draft row in Supabase, never touches Google Ads):
   `node scripts/ff.mjs call ff/audit '{"action":"generate","client_id":"<id>","customer_id":"<10 digits>"}'`
4. Read it back: `node scripts/ff.mjs get audits "id=eq.<id from step 3>&select=markdown,summary"`.
5. Check the big claims live (read only), for example:
   - `node scripts/ff.mjs gaql <cid> "SELECT customer.auto_tagging_enabled, customer.call_reporting_setting.call_reporting_enabled FROM customer"`
   - `node scripts/ff.mjs gaql <cid> "SELECT conversion_action.name, conversion_action.type, conversion_action.status, conversion_action.phone_call_duration_seconds FROM conversion_action WHERE conversion_action.status = 'ENABLED'"`
   - `node scripts/ff.mjs gaql <cid> "SELECT campaign.name, campaign.status, campaign.geo_target_type_setting.positive_geo_target_type, campaign.network_settings.target_search_network FROM campaign WHERE campaign.status != 'REMOVED'"`
   If live data disagrees with the audit, say so at the top of the file.
6. Save the Markdown to `audits/<client slug>.md` (the slug is the business name, never a person's name).
   Add a short "What Rob should decide" list at the end: each item one line, with the setting and the reason.
7. Tell the user: the audit is in the dashboard (client > Audit) waiting for Rob, and the file path. Rob marks it reviewed there.

## What a good audit covers (the SOP)
Campaign types A (at-need, 24/7, presence only) and C (preplanning, office hours); Search only; phrase/exact only;
5-15 keywords per ad group; at most 2 RSAs per ad group; one universal negative list; calls 90s+ and the preplanning
form as primary conversions; auto-tagging and call reporting on; no call recording, whisper or phone menu.
