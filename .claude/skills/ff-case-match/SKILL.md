---
name: ff-case-match
description: Monthly case match for an FF client - prepare the no-name case list, check it with Google Ads, and (Rob) upload signed cases as offline conversions, then report cost per signed case. Use at the start of each month or when asked which ads brought real families.
---

# /ff-case-match - which ads brought real families

The case list is personal data. Handle it like this, always:
- **Do not open, print, summarise or paste the case list.** Only pass its path to the command below. If the user pastes
  case rows into the chat, do not repeat them; ask them to put the file in `case-lists/` (gitignored) instead.
- The list must have **no names**. Allowed columns only: `case_date, value, gclid, gbraid, wbraid, email, phone, call_time`.
  Any other column refuses the file.
- The list is never stored in Supabase. n8n sends it to Google Ads and keeps counts only. The file is deleted after the upload.

## Where the columns come from
- `case_date` - the day the case was signed (YYYY-MM-DD). Required.
- `value` - the case value; empty uses the client's case value.
- `gclid` / `gbraid` / `wbraid` - from the family's GHL contact (the preplanning form captures them).
- `email`, `phone` - the family's contact details, for enhanced conversions (hashed before they reach Google).
- `call_time` - when they first called (YYYY-MM-DD HH:MM), with `phone`, to match calls from ads.
Maggie or DeAnn collect the list from the funeral home each month.

## Steps
1. `node scripts/ff.mjs clients` - client `id` and `customer_id`.
2. The account needs the "FF - Signed case" (and "FF - Signed case call") conversion actions - see /ff-conversions-setup.
3. Check first (FF staff or Rob, nothing is recorded in Google Ads):
   `node scripts/ff.mjs case-match check <client_id> <customer_id> <YYYY-MM> case-lists/<file>.csv`
   Read the counts: accepted, rejected, skipped and the reasons (error code names only).
4. Upload (Rob's login only; refused on a live account until Rob turns writes on for the client):
   `node scripts/ff.mjs case-match upload <client_id> <customer_id> <YYYY-MM> case-lists/<file>.csv`
   Add `--new` only when this month was uploaded before and this file has new cases only. The file is deleted when Google takes it.
   Rob can also do this on the dashboard: client > Case match.
5. Report: `node scripts/ff.mjs get case_match_runs "client_id=eq.<id>&order=created_at.desc&limit=6"` and the month's spend
   (`node scripts/ff.mjs rpc dash_client_totals '{"p_from":"<month start>","p_to":"<month end>"}'`, this client's row).
   Cost per signed case = spend / signed cases. Conversions appear in Google Ads within a day or two.
