// @include shared/gads.js
// "Test connection": each step in order, with the first problem explained in
// plain words. Always answers 200 with ok true/false so the page can show it.
const secrets = $('Get Google Ads secrets').first().json || {};
const token = $('Refresh Google token').first().json || {};
const list = $input.first().json || {};
const done = (ok, message, extra = {}) => [{ json: { status: 200, body: { ok, message, ...extra } } }];

const labels = {
  client_id: 'Client ID', client_secret: 'Client secret', refresh_token: 'refresh token (Connect with Google)',
  developer_token: 'developer token', mcc_id: 'MCC ID',
};
const missing = Object.keys(labels).filter((k) => !secrets[k]);
if (missing.length) return done(false, `Not set yet: ${missing.map((k) => labels[k]).join(', ')}.`);

if (!token.access_token) {
  const e = token.error;
  if (e === 'invalid_grant') return done(false, 'Google refused the refresh token (expired or revoked). Click Connect with Google again. If this keeps happening every 7 days, set the OAuth consent screen to "In production".');
  if (e === 'invalid_client') return done(false, 'Google does not accept the Client ID and Client secret. Check both.');
  return done(false, `Google did not give an access token: ${token.error_description || e || 'no answer'}.`);
}

const error = gadsError(list);
if (error) {
  if (/DEVELOPER_TOKEN_NOT_APPROVED|not approved/i.test(error)) {
    return done(false, 'The developer token is only approved for test accounts. Apply for Basic access in the MCC under Admin > API Center.');
  }
  if (/DEVELOPER_TOKEN_INVALID|developer token/i.test(error)) return done(false, 'Google does not accept the developer token.');
  return done(false, `Google Ads answered with an error: ${error}`);
}

const ids = ((gadsBody(list) || {}).resourceNames || []).map((r) => String(r).split('/').pop());
const mccFound = ids.includes(secrets.mcc_id);
return done(
  mccFound,
  mccFound
    ? `Connected. This login reaches ${ids.length} Google Ads account(s), including the MCC.`
    : `Signed in, but this login cannot reach the MCC ${secrets.mcc_id}. Connect with a Google account that has access to FF's manager account.`,
  { accessible_accounts: ids.length },
);
