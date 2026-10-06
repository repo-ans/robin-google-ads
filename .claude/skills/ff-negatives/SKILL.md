---
name: ff-negatives
description: Weekly search-term triage for an FF client - sort terms into keep / block / ask Rob, record the decisions, and prepare negative keywords (obituaries, jobs, urns and other junk) for Rob to add. Use when asked to block junk searches, review search terms, or clean up negatives.
---

# /ff-negatives - block junk searches

You triage and record decisions. Adding a negative in Google Ads is Rob's step (dashboard, or the command below with Rob's login).

## Rules
- Terms with a person's name are already replaced by "[name removed - ...]" - never try to recover them, never block them by name.
- Never block what the client sells: cremation, direct cremation, funeral home, preplanning, prepaid funeral, the client's towns and brand.
- Prefer the shared "FF Universal Negatives" list for junk that is junk everywhere; campaign-level only for campaign-specific cases.
- Phrase match by default; exact when one word would be too wide.

## Junk themes (block)
Obituaries and death notices; jobs, careers, salary, hiring, school, license, training; urns, caskets, jewelry or
headstones to buy; free, DIY, "how to" research with no service intent; pet cremation (unless the client offers it);
competitors' own brand terms only if Rob says so; other states or far-away towns for campaign A.

## Steps
1. `node scripts/ff.mjs clients` - client `id`, `customer_id`.
2. Campaigns: `node scripts/ff.mjs rpc dash_campaign_totals '{"p_client_id":"<id>","p_from":"<7 days ago>","p_to":"<yesterday>"}'`.
3. For each campaign with spend: `node scripts/ff.mjs rpc dash_search_terms '{"p_customer_id":"<cid>","p_campaign_id":"<campaign_id>","p_from":"<7 days ago>","p_to":"<yesterday>"}'`.
   Skip rows where `is_negated` is true or `decision` is already set.
4. Decide each term: keep, block, or ask_rob (unsure, or spend with conversions you would block). Record it:
   `node scripts/ff.mjs call ff/review-actions '{"action":"triage","customer_id":"<cid>","campaign_id":"<id>","term_hash":"<term_hash>","decision":"block"}'`.
5. Report to the user: a short table per campaign - blocked (with spend), ask Rob (with why), and the suggested
   negative keywords with match type and list vs campaign.
6. Rob adds them: dashboard > campaign > Search Terms > pick terms > "Add as negative". With Rob's own login the same is
   `node scripts/ff.mjs call ff/apply-campaign-action '{"source":"negatives","source_id":"<campaigns.id row uuid>","level":"list","match_type":"PHRASE","terms":["..",".."]}'`
   (Google checks first; every attempt is logged; refused on a live account until writes are turned on for the client).
