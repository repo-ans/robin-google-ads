// @include shared/gads.js
// Turns the MCC's customer_client list into ad_accounts rows.
// New accounts land with client_id = null ("Unassigned"); the upsert never
// sends client_id, so existing assignments are kept. Replaces the reference's
// fake placeholder client rows for discovered accounts.
// The MCC id comes from the dashboard Settings page (Get Google Ads secrets).
const mccRaw = String($('Get Google Ads secrets').first().json.mcc_id || '').replace(/-/g, '');
const MCC_ID = /^[0-9]{10}$/.test(mccRaw) ? mccRaw : '';
const res = $input.first().json || {};
const now = new Date().toISOString();

if (!MCC_ID) {
  return [{ json: { rows: [], mcc_error: 'The MCC ID is not set - enter it on the dashboard Settings page.' } }];
}

const parsed = parseStream(res);
if (parsed.error) {
  return [{ json: { rows: [], mcc_error: parsed.error } }];
}

const seen = new Set();
const rows = [];
for (const r of parsed.rows) {
  const c = r.customerClient || {};
  const id = c.id !== undefined ? String(c.id) : null;
  if (!id || !/^[0-9]{10}$/.test(id) || seen.has(id) || id === MCC_ID) continue;
  seen.add(id);
  rows.push({
    customer_id: id,
    login_customer_id: MCC_ID,
    descriptive_name: c.descriptiveName || null,
    currency_code: c.currencyCode || null,
    time_zone: c.timeZone || null,
    status: c.status || null,
    is_manager: Boolean(c.manager),
    is_test_account: Boolean(c.testAccount),
    synced_at: now,
  });
}

return [{ json: { rows, mcc_error: null } }];
