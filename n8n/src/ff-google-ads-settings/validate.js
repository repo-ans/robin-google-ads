// @include shared/input.js
// Body:
//   { action: "test" }                                  FF staff or Rob
//   { action: "save", values: { developer_token?, client_id?, client_secret?, refresh_token?, mcc_id? } }   Rob only
//   { action: "exchange_code", code, redirect_uri }     Rob only ("Connect with Google")
// Empty fields in "save" mean "keep the saved value".
const b = requestBody();
const user = caller();

if (b.action === 'test') return [{ json: { valid: true, action: 'test' } }];
if (user.role !== 'rob_admin') return reject(403, 'Only Rob can change the Google Ads connection.');

if (b.action === 'save') {
  const v = b.values && typeof b.values === 'object' ? b.values : {};
  const out = {};
  const clientId = text(v.client_id, 300);
  if (clientId) {
    if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId)) return reject(400, 'The Client ID should look like 1234-abc.apps.googleusercontent.com.');
    out.client_id = clientId;
  }
  const secret = text(v.client_secret, 200);
  if (secret) out.client_secret = secret;
  const dev = text(v.developer_token, 100);
  if (dev) {
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(dev)) return reject(400, 'The developer token has letters, numbers, - or _ only.');
    out.developer_token = dev;
  }
  const refresh = text(v.refresh_token, 1000);
  if (refresh) out.refresh_token = refresh;
  if (v.mcc_id) {
    const mcc = customerId(v.mcc_id);
    if (!mcc) return reject(400, 'The MCC ID is 10 digits, like 123-456-7890.');
    out.mcc_id = mcc;
  }
  if (!Object.keys(out).length) return reject(400, 'Nothing to save - fill in at least one field.');
  return [{ json: { valid: true, action: 'save', values: out } }];
}

if (b.action === 'exchange_code') {
  const code = text(b.code, 2000);
  const redirect = text(b.redirect_uri, 300);
  if (!code) return reject(400, 'Google did not send a sign-in code.');
  if (!/^(https:\/\/[a-z0-9.-]+|http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?)\/settings\/google-callback$/i.test(redirect)) {
    return reject(400, 'The return address is not the dashboard Settings page.');
  }
  return [{ json: { valid: true, action: 'exchange_code', code, redirect_uri: redirect } }];
}

return reject(400, 'action must be test, save or exchange_code.');
