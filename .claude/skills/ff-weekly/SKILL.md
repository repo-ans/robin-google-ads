---
name: ff-weekly
description: The Monday report for FF clients - run or read the weekly numbers (spend, calls 90s+, forms, arrangements, tracking health, flags), add search-term triage, and write the short note for Rob. Use on Mondays or when asked for the weekly report.
---

# /ff-weekly - Monday report

The ff-weekly-report workflow runs every Monday 08:00 by itself (weekly_stats, tracking_health, the client's Google Sheet,
the Slack note to Rob). This skill checks it ran, fills gaps, and adds the triage.

## Steps
1. Last week = Monday to Sunday before this week. `node scripts/ff.mjs clients` for the client ids.
2. Did Monday's run happen? `node scripts/ff.mjs get weekly_stats "week_start=eq.<last Monday>&select=client_id,cost_micros,calls_90s,forms,arrangements,tracking_ok,flags,decisions,sheet_written_at"`.
   Missing client: `node scripts/ff.mjs call ff/weekly-report '{"client_id":"<id>","week_start":"<last Monday>"}'`
   (no Slack note unless you add `"slack":true` - only do that if the user asks).
3. Tracking health: /ff-tracking-check for any client with `tracking_ok = false`.
4. Search-term triage: /ff-negatives for each active client (7 days).
5. Write the note for Rob, per client, at most 5 lines:
   `<Client> - spend $X, calls 90s+ N, forms N, arrangements N ($X). Tracking: ok / <problem>. Needs Rob: <decision or "nothing">.`
   Then one line overall. Calm tone, plain hyphens, no emoji, no names, no search terms with names.
6. Point to the dashboard (client page > Weekly report) and the client's Sheet for the history.
