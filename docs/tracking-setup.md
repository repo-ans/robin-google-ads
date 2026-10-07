# Tracking setup - calls 90s+, preplanning forms, weekly report

For: Manam (build), Arni (WordPress), Nerlyn (GHL), Rob (approves). Works the same for every client account, now and future.
Covers PDF tasks 2 (calls), 3 (forms) and 8 (weekly report). Rules that apply throughout: FF owns every account,
nothing personal in tags, URLs or notifications, no call recording, whisper or phone menu, plain hyphens, no emoji.

## 0. Once for FF (n8n)

| n8n credential (exact name) | Type | Value |
|---|---|---|
| FF GHL OAuth | OAuth2 API | FF's private GHL Marketplace app, connected once as the agency (see below) |
| FF Google Sheets | Google Sheets OAuth2 API | Sign in with the FF Google account that owns the client Sheets |
| FF Slack | Slack API | Bot token (already used by ff-sync) |

**One FF GHL app for every client** (2026-10-06 - an agency private integration key cannot open sub-accounts, so
it is not used). In marketplace.gohighlevel.com, signed in with FF's developer account: Create app - type **Private**,
target user **Sub-Account**, who can install **Agency only**. Scopes: `oauth.readonly`, `oauth.write`,
`locations.readonly`, `contacts.readonly`, `opportunities.readonly`, `locations/customFields.readonly`,
`locations/customFields.write`, `locations/tags.readonly`, `locations/tags.write`. Redirect URL: the "OAuth Redirect
URL" shown on the n8n credential below. Install the app from the agency on every sub-account (bulk install).

n8n credential **FF GHL OAuth** (type OAuth2 API):
- Grant Type: Authorization Code
- Authorization URL: `https://marketplace.gohighlevel.com/oauth/chooselocation`
- Access Token URL: `https://services.leadconnectorhq.com/oauth/token`
- Client ID / Client Secret: from the app
- Scope: the scopes above, separated by spaces
- Authentication: Send credentials in body
- Press **Connect my account** and choose the **agency** (not a sub-account).

For each client the workflows turn the agency token into a short-lived token for that client's sub-account
(`POST /oauth/locationToken`), so existing and new clients need nothing of their own - only the app installed on their
sub-account. Copy the agency (company) ID from Agency Settings (or the agency view URL) into `GHL_COMPANY_ID` in the
Config node of ff-weekly-report, ff-ghl-setup and ff-case-match.
Keep the client secret only in n8n - never in chat, code or the dashboard.

Import `n8n/ff-weekly-report.json` and `n8n/ff-ghl-setup.json` like the other workflows (Config: `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `GHL_COMPANY_ID`; ff-weekly-report also `SLACK_CHANNEL` = Rob's channel and `DASHBOARD_URL`), pick the credentials,
set Allowed Origins on the Webhook node, set the workflow time zone, activate.

## 1. Client settings (dashboard)

Client page > Edit client:
- **GHL sub-account** - click **Pick from GHL** and choose the client's sub-account (the one with the same name is
  picked for you; check it). Do this once for every existing client that uses GHL.
- **Google Sheet** - paste the Sheet link. The Sheet needs a tab named `Weekly` whose first row is exactly:

  `Week | Week end | Spend | Currency | Clicks | Calls 90s+ | Forms | Arrangements | Arrangement value | Cost per conversion | GHL Google Ads leads | Tracking | Flags | Needs Rob`

  Share the Sheet with the FF Google account used in "FF Google Sheets" (editor).

Then on the client page, Tracking health: **Check GHL**, then **Set up GHL fields**. This creates the contact fields
`gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_term, utm_content` and the tag `from google ads`,
and nothing else. Run **Check GHL** again - it should say GHL is ready.

## 2. Preplanning form (Nerlyn, GHL)

1. Open the preplanning form in the form builder. Add the 8 fields above as **Hidden** fields.
2. For each hidden field set the query key to the same name (`gclid` -> `gclid`, `utm_source` -> `utm_source`, ...),
   so the value in the form address fills the field.
3. Form settings > On submit: **Open URL** -> the website's thank-you page, e.g. `https://<site>/thank-you-preplanning`
   (Arni creates it). Google Ads counts the form there.
4. Build the workflow below. Publish it.

### GHL workflow: "FF - Preplanning form - Google Ads tag and notify"

Paste into GHL Workflow AI (then check it against the checklist - Workflow AI can flatten branches):

> Create a workflow triggered by Form Submitted, filtered to the form "Preplanning" only. First step: If Else - if the
> contact field gclid is not empty, or gbraid is not empty, or wbraid is not empty, or utm_source is google, add the
> contact tag "from google ads"; otherwise do nothing. After the If Else, on both paths, with no wait: Send Internal
> Notification by SMS to the funeral home's notification phone with the text "New preplanning request from the
> website. Please call them back today - open the contact in GHL for details." and Send Internal Notification by email
> to the funeral home's notification email with the subject "New preplanning request" and the body "A family sent a
> preplanning request on the website. Please call them back today. The contact is in GHL under Contacts, newest first.
> - Funeral Futurist". Do not send any message to the contact. Do not add a wait step.

Manual build checklist:

```
TRIGGER: Form Submitted
  Filter: Form is "Preplanning" (the preplanning form only)

STEP 1 - If Else: "Came from Google Ads?"
  Branch YES when ANY of:
    gclid is not empty
    gbraid is not empty
    wbraid is not empty
    utm_source is "google"
  |- YES: STEP 1a - Add Contact Tag: from google ads
  |- NONE: (no action)

STEP 2 - Send Internal Notification (SMS)        <- after the If Else, both paths join here, no Wait step
  To: the funeral home's notification phone (a GHL user or a specific number)
  Text: New preplanning request from the website. Please call them back today - open the contact in GHL for details.

STEP 3 - Send Internal Notification (Email)
  To: the funeral home's notification email
  Subject: New preplanning request
  Body: A family sent a preplanning request on the website. Please call them back today.
        The contact is in GHL under Contacts, newest first. - Funeral Futurist
```

Checks for Nerlyn:
- The tag text is exactly `from google ads` (the weekly report counts it; it must match `GHL_GOOGLE_ADS_TAG`).
- The notifications must not use `{{contact.name}}` or any other name merge field - names stay inside GHL only.
- No SMS or email goes to the family from this workflow. No call step, no IVR.
- Who receives the notifications at the funeral home: ask Rob for the phone and email.

## 3. Website (Arni, WordPress)

1. The Google tag (gtag.js) with FF's Google Ads tag ID is on every page (Google Ads > Goals > Summary > Google tag).
2. Add before `</body>` on every page (WPCode, footer, all pages):

   ```html
   <script src="https://<dashboard URL>/ff-click-id.js" defer
     data-form-conversion="AW-XXXXXXXXX/form-label"
     data-thank-you-path="/thank-you-preplanning"
     data-phone-conversion="AW-XXXXXXXXX/call-label"
     data-phone="(843) 555-0100"></script>
   ```

   The two `AW-.../label` values come from the conversion actions in section 4. `data-phone` is the number exactly as
   it is written on the site. Leave a `data-` line out to skip that part.
3. Create the thank-you page at `/thank-you-preplanning` (calm text: "Thank you. We will call you soon.").
4. The GHL form embed stays as GHL gives it. The script adds the click values to it.

What the script does: keeps `gclid / gbraid / wbraid / utm_*` from the ad click for 90 days in a first-party cookie,
adds them to the GHL form, fires the form conversion once on the thank-you page, and switches on Google's website call
tracking. It stores nothing personal. Check on a live page: open the site with `?gclid=TEST123`, then in the browser
console run `ffClickIds()` - it shows `gclid: "TEST123"`.

## 4. Call tracking in Google Ads (one click per account, Rob)

Dashboard > client > **Call tracking** shows every Google Ads account of the client with a checklist from the last
sync. When something is missing, Rob presses **Set up call tracking**. Only the missing parts are changed, each checked
by Google first (validateOnly) and logged:

| Part | What the button does |
|---|---|
| Account settings | Call reporting on, call conversion reporting on, auto-tagging on |
| Calls from ads 90s+ | Creates it (AD_CALL, 90 seconds, count One, primary, value = the client's case value), or fixes ours if it is not at 90s |
| Calls from website 90s+ | Same, type WEBSITE_CALL - its `AW-.../label` value reaches the dashboard with the next sync |
| Call asset | One call asset with the business phone on the whole account, so every campaign shows it - also campaigns built later. Uses the client's Business phone, or the number already on a call asset in the account |

Nothing records calls, and there is no menu or message: calls ring straight through, and Google's forwarding number
passes the family's real number to the funeral home. Live accounts need "Google Ads writes" turned on for the client
first (test account first).

After the next sync, **Copy website script** on the same card gives the exact script for the client's site (Google tag,
`data-phone-conversion`, `data-phone`, and `data-form-conversion` when a lead form action exists) - Arni pastes it in
the site footer (section 3).

The preplanning form action (Website > Submit lead form, thank-you page) is still made in Google Ads; its value then
appears in the copied script by itself.

## 5. Test and proof (one of each)

| Test | Pass when | Proof |
|---|---|---|
| Ad call | Call the number on the ad from a phone, stay 2 minutes | Shows in Google Ads > Goals > Conversions (can take a few hours) - screenshot |
| Website call | Click the real ad (a test `?gclid=` does not make Google show its forwarding number), then call the number shown on the site, stay 2 minutes | Google forwarding number shown, call counted - screenshot |
| Form | Open the site with `?gclid=TEST123&utm_source=google`, leave, come back without it, fill the form | Contact in GHL has gclid TEST123 and tag `from google ads`; funeral home gets the SMS and email within a minute, with no name in them; thank-you page fired the conversion (Tag Assistant recording) |
| Weekly report | Client page > Weekly report > Run for last week | Row on the client page, row in the Sheet's Weekly tab; Monday note in Slack after the first scheduled run |

Delete the test contact in GHL afterwards.

## 6. Online cremation sales (Process 2 - Arni with the checkout owner, Manam)

Goal: a paid arrangement counts once in Google Ads, after the payment is confirmed, with its real amount and order id.
An "arrangement started" event counts the start of the flow.

1. Flow map first (Arni): which page starts the arrangement, which system takes the payment (WooCommerce, GHL order
   form, Stripe checkout, other), and which page the family sees **only after** a confirmed payment. Write the three
   addresses down. The confirmation page must not be reachable without paying (no direct link in menus).
2. Google Ads conversion actions (section 4 style, by hand): "Arrangement started" (Begin checkout, count One,
   secondary) and "Online arrangement paid" (Purchase, count Every, transaction-specific value, primary).
3. The confirmation page must give the script the amount and the order id - one of:
   - the checkout code calls `window.ffPurchase({ value: 1995, order_id: 'A-1234', currency: 'USD' })` after payment
     (before the script has loaded: `(window.ffPurchaseQueue = window.ffPurchaseQueue || []).push({...})`);
   - the confirmation address carries them, e.g. `/order-confirmed?total=1995&order=A-1234`
     (then set `data-purchase-value-param="total"` and `data-purchase-order-param="order"`);
   - the page has `<span data-ff-purchase-value="1995" data-ff-order-id="A-1234" hidden></span>`.
   Never put the family's name or email in the address or on these elements.
4. Add to the script tag from section 3:

   ```html
   data-start-conversion="AW-XXXXXXXXX/start-label" data-start-path="/arrange"
   data-purchase-conversion="AW-XXXXXXXXX/purchase-label" data-purchase-path="/order-confirmed"
   data-currency="USD"
   ```

   The script sends the purchase once per order id (Google also drops a repeat with the same transaction id), only on
   the confirmation page, and never without an amount and an order id.
5. Test (milestone M4): one real test arrangement end to end. Pass when Tag Assistant shows one purchase with the right
   value and order id, a page reload sends nothing more, and Google Ads > Goals shows it within a few hours. Refund the
   test order.

## 7. Monthly case match (Maggie or DeAnn collect, Rob uploads)

1. "Case signed" (Import > clicks) and "Case signed - calls" (Import > calls) are made by Rob's **Set up call tracking**
   button (client page > Call tracking). They are secondary goals: reported, not used for bidding unless Rob changes that.
2. On the first business day of the month the daily sync sends Rob a Slack reminder that last month's lists are due.
3. **Preferred - straight from GHL, no file:** when a family signs, the funeral home sets the opportunity to **Won** in GHL
   (any pipeline). Case match page > **From GHL** > Check / Upload: n8n reads that month's won opportunities and their
   contacts (phone, email, click id) from the client's sub-account with FF's one agency key, sends them to Google and
   keeps nothing. Works for every sub-account picked on Edit client, now and future.
4. Otherwise each funeral home sends last month's signed cases as a file, **no names**. CSV columns (dashboard > client > Case match >
   Download template): `case_date, case_type, phone, email, call_time, value, gclid, gbraid, wbraid`.
   - `case_date` (required) - the day the case was signed; `case_type` - at-need, preneed ... (counted only)
   - `phone` + `call_time` (when they first called, YYYY-MM-DD HH:MM) - matches calls from ads. Google never shares
     caller numbers (and FF never stores them), so Google does this match itself from the number and the time.
   - `email` / `phone` alone - hashed, matched by Google to ad clicks and forms (enhanced conversions)
   - `gclid` from the GHL contact - exact match for families who used the website form
4. Dashboard > client > Case match: choose the month and the file, **Check with Google Ads** (FF staff or Rob - nothing is
   recorded), then Rob presses **Upload to Google Ads**. Or with Claude Code: `/ff-case-match`.
5. The log (Supabase `case_match_runs`, counts only): in, matched (sent to Google), uploaded, rejected (with Google's
   reason codes), unattributed (first contact more than 90 days ago - Google cannot match them; not a failure), no id
   (no phone, email or click id), and case types. Cost per signed case per month is shown on the same page.
6. Delete the file everywhere (email, downloads) after the upload. The command line deletes it by itself after a successful upload.
7. Proof (milestone M3): the run in the Case match history and the "Case signed" conversions in Google Ads > Goals.
