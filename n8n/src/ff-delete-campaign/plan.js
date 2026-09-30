// @include shared/input.js
// Body: { campaign_row_id }. rob_admin only (Config ALLOWED_ROLES).
// Google Ads never hard-deletes: "remove" sets the campaign to REMOVED. The
// dashboard keeps its history (removed_at), unlike the reference's hard delete.
const cfg = $('Config').first().json;
const b = requestBody();
const c = $input.first().json || {};
const refuse = (status, error) => [{ json: { ok: false, status, error, c } }];

if (!isUuid(b.campaign_row_id)) return refuse(400, 'campaign_row_id is missing or not valid.');
if (!c.customer_id) return refuse(404, 'Campaign not found.');
if (c.removed_at || c.status === 'REMOVED') return refuse(409, 'This campaign is already removed.');
const acct = c.ad_accounts || {};
const writesEnabled = Boolean(acct.clients && acct.clients.writes_enabled);
if (!acct.is_test_account && !writesEnabled) {
  return refuse(403, 'Writes are not turned on for this client yet. Test on the Google Ads test account first, then Rob can turn writes on in the client settings.');
}

const resource = `customers/${c.customer_id}/campaigns/${c.campaign_id}`;
return [{
  json: {
    ok: true,
    c,
    customer_id: c.customer_id,
    login_customer_id: acct.login_customer_id || null,
    is_test_account: Boolean(acct.is_test_account),
    api_version: cfg.GOOGLE_ADS_API_VERSION,
    mutate_body: { operations: [{ remove: resource }] },
  },
}];
