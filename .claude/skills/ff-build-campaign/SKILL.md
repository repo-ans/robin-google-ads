---
name: ff-build-campaign
description: Draft a clean FF Google Ads campaign (template A at-need or C preplanning) for a client - keywords from DataForSEO and search terms, calm ad copy - and save it as a draft for Rob. Use when asked to build, plan or draft a campaign. Never builds or enables it.
---

# /ff-build-campaign - draft a campaign for Rob

You draft. Rob builds (it is created PAUSED) and Rob enables. You never call `"action":"build"`.

## Rules
- Templates: **A - Local at-need** ("cremation [town]", "funeral home [town]"), presence only, 24/7.
  **C - Preplanning** (preplan, prepaid, prearranged terms), office hours. B (out-of-area family) only if Rob asks and volume shows.
- Search network only. Phrase or exact match only - never broad. 5 to 15 keywords per ad group. At most 2 RSAs per ad group.
- Ad copy: calm and respectful, plain hyphens, no emoji, no urgency tricks, no prices unless the client gave them.
  Headlines at most 30 characters, descriptions at most 90, paths at most 15.
- No personal names in keywords, copy, URLs or the campaign name.
- No call recording, whisper or phone menu - calls ring straight through.

## Steps
1. `node scripts/ff.mjs clients` - pick the client `id` and `customer_id`. Note the client's towns:
   `node scripts/ff.mjs get clients "id=eq.<id>&select=name,towns,website_url,office_hours,competitor_terms,own_brand_terms,dataforseo_location_code"`.
2. Keyword ideas with real volume (DataForSEO, refreshed weekly; keyed by keyword and location, not by client):
   `node scripts/ff.mjs get keyword_volume "source=eq.dataforseo&geo_target=eq.<dataforseo_location_code>&order=avg_monthly_searches.desc.nullslast&limit=100&select=keyword_norm,avg_monthly_searches,avg_cpc_micros,competition,related_keywords"`.
   Also try candidate terms one by one with `keyword_norm=eq.<term>`. If nothing comes back, run
   `node scripts/ff.mjs call ff/keyword-research '{"client_id":"<id>"}'` (or "Refresh keyword data" on the System page) and come back later.
3. What already works: `node scripts/ff.mjs rpc dash_campaign_totals '{"p_client_id":"<id>","p_from":"<90 days ago>","p_to":"<yesterday>"}'`
   and the search terms of the best campaign (`rpc dash_search_terms`). Keep terms that converted; skip junk (see /ff-negatives).
4. Pick 5-15 keywords per ad group, phrase/exact, grouped by theme (cremation vs funeral home vs preplanning).
5. Location: the client's towns. Look up ids with `node scripts/ff.mjs call ff/geo-target-suggest '{"query":"<town, state>","country":"US"}'`.
6. Write 1-2 RSAs per ad group (8-15 headlines, 2-4 descriptions), final URL on the client's site.
7. Save the draft (FF staff can do this; nothing goes to Google Ads):
   `node scripts/ff.mjs call ff/build-campaign '<json>'` with
   `{"action":"save_draft","client_id":..,"customer_id":..,"template":"A"|"C","name":"A - At-need - <Town>","daily_budget":<number>,"bidding_strategy":"MAXIMIZE_CONVERSIONS","geo_targets":[{"resource_name":"geoTargetConstants/..","name":".."}],"ad_groups":[{"name":..,"final_url":..,"keywords":[{"text":..,"match_type":"PHRASE"}],"ads":[{"headlines":[..],"descriptions":[..],"path1":..}]}]}`.
   The answer lists any rule issues - fix them and save again.
8. Tell the user the draft is in the dashboard (client > Campaign builder) for Rob to review, build (paused) and enable.
   Suggest a budget, but say clearly that Rob decides budgets and bids.
