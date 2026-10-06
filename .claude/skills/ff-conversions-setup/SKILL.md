---
name: ff-conversions-setup
description: Check which Google Ads conversion actions an FF client account has and write the exact setup list for the missing ones - calls 90s+, preplanning form, signed case uploads, online cremation purchase. Use when setting up tracking for a new client or when /ff-tracking-check finds gaps.
---

# /ff-conversions-setup - the conversion actions every FF account needs

Call tracking (call reporting, auto-tagging, both 90s call actions, the account call asset) is one click for Rob:
dashboard > client > Call tracking > Set up call tracking. The other actions are made in Google Ads by FF (Rob
approves). This skill reads what exists and writes the to-do list - it does not create anything. Full steps for people: `docs/tracking-setup.md`.

## The list
| Name (exact) | Google Ads type | Settings | Used by |
|---|---|---|---|
| Calls from ads 90s+ | Phone calls > Calls from ads using call assets | Call length 90 seconds, count One, primary | Process 1 |
| Calls from website 90s+ | Phone calls > Calls to a number on your website | 90 seconds, count One, primary; label goes in `data-phone-conversion` | Process 1 |
| Preplanning form | Website > Submit lead form (thank-you page) | Count One, primary; label goes in `data-form-conversion` | Process 1 |
| FF - Signed case | Import > CRM / clicks (offline click conversions) | Count One, primary, value = case value | case match |
| FF - Signed case call | Import > calls | Count One, primary | case match |
| Arrangement started | Website > Begin checkout | Count One, secondary; label in `data-start-conversion` | Process 2 |
| Online arrangement paid | Website > Purchase | Count Every, primary, use transaction-specific value; label in `data-purchase-conversion` | Process 2 |

Account settings: auto-tagging ON, call reporting ON, enhanced conversions for leads ON (helps the case match).
No call recording, whisper or phone menu.

## Steps
1. `node scripts/ff.mjs clients` - pick `customer_id`; note `process` (funeral_home = Process 1, online_cremation = Process 2).
2. Read live (read only):
   `node scripts/ff.mjs gaql <cid> "SELECT conversion_action.id, conversion_action.name, conversion_action.type, conversion_action.category, conversion_action.status, conversion_action.primary_for_goal, conversion_action.counting_type, conversion_action.phone_call_duration_seconds, conversion_action.tag_snippets FROM conversion_action WHERE conversion_action.status != 'REMOVED'"`
   and `node scripts/ff.mjs gaql <cid> "SELECT customer.auto_tagging_enabled, customer.call_reporting_setting.call_reporting_enabled, customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled FROM customer"`.
3. Compare with the list. Names for the case match must match exactly ("FF - Signed case", "FF - Signed case call") -
   ff-case-match finds them by name and type.
4. Write the to-do for the user: missing actions, wrong settings (for example a call action at 60 seconds), and for each
   website action the `AW-.../label` value that goes in the website script (from `tag_snippets`, the `send_to` value).
5. When the actions exist, run /ff-tracking-check to test them.
