---
name: ff-monthly
description: Month-end review for an FF client - spend, conversions, cost per signed case from the case match, best and worst campaigns, time-of-day and device patterns, and a short list of decisions for Rob. Use at the start of a month or when asked for a monthly summary.
---

# /ff-monthly - month-end review

Read only. Decisions (budgets, bids, schedules, enabling) are Rob's - you suggest, with the numbers.

## Steps
1. Month = last calendar month unless the user says otherwise. `node scripts/ff.mjs clients`.
2. Totals: `node scripts/ff.mjs rpc dash_client_totals '{"p_from":"<month start>","p_to":"<month end>"}'` (and the month before, for comparison).
3. Campaigns: `node scripts/ff.mjs rpc dash_campaign_totals '{"p_client_id":"<id>","p_from":"..","p_to":".."}'`.
4. Signed cases: run /ff-case-match first if this month is not uploaded yet, then
   `node scripts/ff.mjs get case_match_runs "client_id=eq.<id>&month=eq.<YYYY-MM-01>&validate_only=eq.false"`.
   Cost per signed case = month spend / signed cases.
5. When people call and convert: `node scripts/ff.mjs rpc dash_hourly '{"p_customer_id":"<cid>","p_campaign_id":"<id>","p_from":"..","p_to":".."}'`
   and `dash_device` with the same arguments. Note hours with spend and no calls or conversions (ad schedule ideas for Rob).
6. Weekly flags of the month: `node scripts/ff.mjs get weekly_stats "client_id=eq.<id>&week_start=gte.<month start>&order=week_start"`.
7. Write the review (Markdown, at most one page): numbers vs last month, cost per signed case, what worked, what to stop,
   and "Decisions for Rob" (each: the change, the expected effect, the risk). Calm tone, plain hyphens, no emoji, no names.
