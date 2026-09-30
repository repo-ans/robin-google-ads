// Result of ff_set_google_ads_secrets. Never echoes the values.
const r = $input.first().json || {};
const ok = r.statusCode >= 200 && r.statusCode < 300;
if (ok) return [{ json: { status: 200, body: { ok: true, message: `Saved ${r.body} value(s).` } } }];
const msg = String((r.body && r.body.message) || 'Could not save.');
return [{ json: { status: 400, body: { error: /mcc_id/.test(msg) ? 'The MCC ID is 10 digits, like 123-456-7890.' : 'Could not save the settings.' } } }];
