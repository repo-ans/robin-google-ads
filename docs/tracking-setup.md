# Tracking setup - calls 90s+, preplanning forms, weekly report

For: Manam (build), Arni (WordPress), Nerlyn (GHL), Rob (approves). One client at a time, pilot first (McCall Gardens).
Covers PDF tasks 2 (calls), 3 (forms) and 8 (weekly report). Rules that apply throughout: FF owns every account,
nothing personal in tags, URLs or notifications, no call recording, whisper or phone menu, plain hyphens, no emoji.

## 0. Once for FF (n8n)

| n8n credential (exact name) | Type | Value |
|---|---|---|
| FF GHL | Header Auth | Name `Authorization`, Value `Bearer <GHL agency-level private integration key>`; Allowed domains: `services.leadconnectorhq.com` |
| FF Google Sheets | Google Sheets OAuth2 API | Sign in with the FF Google account that owns the client Sheets |
| FF Slack | Slack API | Bot token (already used by ff-sync) |

**One agency-level GHL key for every client** (approved by Robin, 2026-10-02). Create it in the GHL agency view:
Agency Settings > Private Integrations > Create. Scopes: `oauth.readonly`, `oauth.write`, `locations.readonly`,
`contacts.readonly`, `locations/customFields.readonly`, `locations/customFields.write`, `locations/tags.readonly`,
`locations/tags.write`. For each client the workflows turn it into a short-lived token for that client's sub-account
(`POST /oauth/locationToken`), so existing and new clients need no key of their own. Copy the agency (company) ID
from Agency Settings (or the agency view URL) into `GHL_COMPANY_ID` in the Config node of both GHL workflows.
Keep the key only in n8n - never in chat, code or the dashboard.

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

## 4. Google Ads conversion actions (Manam, Rob approves; FF account)

| Action | Type | Settings |
|---|---|---|
| Calls from ads 90s+ | Phone calls > Calls from ads using call assets | Call length 90 seconds, count One, primary |
| Calls from website 90s+ | Phone calls > Calls to a phone number on your website | Call length 90 seconds, count One, primary - its label goes in `data-phone-conversion` |
| Preplanning form | Website > Submit lead form (manual, thank-you page) | Count One, primary - its label goes in `data-form-conversion` |

- Account settings: auto-tagging ON, call reporting ON (the weekly report flags both if off).
- Call asset on campaigns A and C with the business number, call reporting on. Google forwarding numbers pass the
  caller's real number through to the funeral home, and calls ring straight through - no recording, no menu.
- These are changes in Google Ads made by hand by FF in the FF account, not by the dashboard. Rob approves.

## 5. Test and proof (one of each)

| Test | Pass when | Proof |
|---|---|---|
| Ad call | Call the number on the ad from a phone, stay 2 minutes | Shows in Google Ads > Goals > Conversions (can take a few hours) - screenshot |
| Website call | Open the site from an ad click (or `?gclid=TEST...`), call the shown number, stay 2 minutes | Google forwarding number shown, call counted - screenshot |
| Form | Open the site with `?gclid=TEST123&utm_source=google`, leave, come back without it, fill the form | Contact in GHL has gclid TEST123 and tag `from google ads`; funeral home gets the SMS and email within a minute, with no name in them; thank-you page fired the conversion (Tag Assistant recording) |
| Weekly report | Client page > Weekly report > Run for last week | Row on the client page, row in the Sheet's Weekly tab; Monday note in Slack after the first scheduled run |

Delete the test contact in GHL afterwards.
