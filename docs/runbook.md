# FF Google Ads - runbook (one page)

For: FF team members running the work without Manam. Rob approves every change in Google Ads.

## Every week (Monday)
1. 08:00 the weekly report runs by itself: numbers in the dashboard, a row in each client's Google Sheet, a Slack note to Rob.
2. In Claude Code, in this repo: `/ff-weekly` - checks the run, fills gaps, triages search terms, drafts Rob's note.
3. `/ff-negatives` for any client with junk searches - Rob adds the negatives (dashboard > campaign > Search Terms).
4. Anything flagged in tracking: `/ff-tracking-check`.

## Every month (first week)
1. Maggie or DeAnn get last month's signed cases from each funeral home - no names (see docs/tracking-setup.md section 7).
2. `/ff-case-match` - check the list; Rob uploads. Delete the file afterwards.
3. `/ff-monthly` - month review with cost per signed case and decisions for Rob.

## New client
1. Dashboard: the Google Ads account appears after a sync and becomes a client by itself. Edit the client: towns, case
   value, website, GHL sub-account, Google Sheet.
2. `/ff-audit` - read-only audit, saved in `audits/`, Rob reads it in the dashboard.
3. `/ff-conversions-setup` then docs/tracking-setup.md (calls 90s+, form, website script, GHL) - then `/ff-tracking-check`.
4. `/ff-build-campaign` - drafts A and C for Rob. Rob builds (paused) and turns them on.

## Setup on a new laptop (once)
- Clone the FF repo, install Node 20+, open Claude Code in the repo folder.
- Copy `.env.example` to `.env` and fill the `FF_` lines with your own dashboard login (ff_staff). Nothing else.
- Test: `node scripts/ff.mjs whoami` shows your role; `node scripts/ff.mjs clients` lists the clients.

## Rules that never change
- Only Rob enables campaigns, changes budgets or bids, adds negatives in Google Ads, or uploads cases. Everything new is built paused.
- No family or deceased names anywhere - not in files, chat, tags or notes. Case lists are deleted after upload.
- No call recording, whisper or phone menu. Calm tone, plain hyphens, no emoji.
- Something looks wrong: stop, write down what you saw, tell Rob. Do not "fix" Google Ads by hand outside these steps.
