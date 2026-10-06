---
name: ff-tracking-check
description: Health check of an FF client's tracking - Google Ads conversion actions and settings, the website click id script and Google tag, the GHL fields and tag, and the latest weekly flags. Use weekly, after a setup change, or when numbers look wrong.
---

# /ff-tracking-check - is everything still counting?

Read only. Report what is broken and who fixes it (Manam: Google Ads and n8n; Arni: WordPress; Nerlyn: GHL; Rob approves).

## Steps
1. `node scripts/ff.mjs clients` - client `id`, `customer_id`, `ghl_location_id`, website.
2. Conversion health (from the last sync):
   `node scripts/ff.mjs get v_tracking_health "customer_id=eq.<cid>&select=name,type,status,primary_for_goal,phone_call_duration_seconds,last_conversion_date,flag_no_recent_conversions,flag_call_duration_not_90s"`
   Flags: spend but no conversion for 14+ days; a call action not at 90 seconds.
3. Account settings live: `node scripts/ff.mjs gaql <cid> "SELECT customer.auto_tagging_enabled, customer.call_reporting_setting.call_reporting_enabled FROM customer"`.
4. Weekly flags: `node scripts/ff.mjs get weekly_stats "client_id=eq.<id>&order=week_start.desc&limit=2&select=week_start,tracking_ok,flags,decisions,calls_90s,forms,arrangements,ghl_google_leads"`.
5. GHL: `node scripts/ff.mjs call ff/ghl-setup '{"action":"check","client_id":"<id>"}'` - fields gclid, gbraid, wbraid, utm_* and the tag "from google ads".
6. Website (fetch the client's home page and the thank-you / confirmation pages):
   - the Google tag (`gtag/js?id=AW-...`) is on every page;
   - `ff-click-id.js` is loaded, with `data-form-conversion`, `data-thank-you-path`, `data-phone-conversion`, `data-phone`
     (and for online cremation `data-purchase-conversion`, `data-purchase-path`);
   - the `AW-.../label` values match the conversion actions from /ff-conversions-setup.
   Then ask the user to open `<site>/?gclid=TEST123` and run `ffClickIds()` in the browser console - it must show TEST123.
7. Report: a short list, worst first, each line "what - why it matters - who fixes it". Plain hyphens, no emoji.
