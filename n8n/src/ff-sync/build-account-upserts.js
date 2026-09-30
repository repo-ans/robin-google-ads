// @include shared/gads.js
// Turns the MCC's customer_client list into ad_accounts rows.
// New accounts land with client_id = null ("Unassigned"); the upsert never
// sends client_id, so existing assignments are kept. Replaces the reference's
// fake placeholder client rows for discovered accounts.
const cfg = $('Config').first().json;
const res = $input.first().json || {};
const now = new Date().toISOString();

if (!cfg.MCC_ID) {
  return [{ json: { rows: [], mcc_error: 'MCC_ID is not set in Config' } }];
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
  if (!id || !/^[0-9]{10}$/.test(id) || seen.has(id) || id === cfg.MCC_ID) continue;
  seen.add(id);
  rows.push({
    customer_id: id,
    login_customer_id: cfg.MCC_ID,
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
