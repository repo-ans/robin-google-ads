// Google's answer to the sign-in code. Passes the refresh token on to be saved;
// it is never returned to the browser.
const r = $input.first().json || {};
const body = r.body || {};
if (r.statusCode >= 200 && r.statusCode < 300 && body.refresh_token) {
  return [{ json: { ok: true, refresh_token: body.refresh_token } }];
}
let error;
if (body.access_token && !body.refresh_token) {
  error = 'Google signed you in but sent no refresh token. Remove the app at myaccount.google.com/permissions, then connect again.';
} else if (body.error === 'redirect_uri_mismatch') {
  error = 'This dashboard address is not in the OAuth client\'s "Authorized redirect URIs" in Google Cloud. Add it (shown on the Settings page) and try again.';
} else if (body.error === 'invalid_client') {
  error = 'Google does not accept the saved Client ID and Client secret. Check both on the Settings page.';
} else if (body.error === 'invalid_grant') {
  error = 'The sign-in code expired or was already used. Click Connect with Google again.';
} else {
  error = `Google did not give a refresh token: ${body.error_description || body.error || `status ${r.statusCode}`}`;
}
return [{ json: { ok: false, status: 400, body: { error } } }];
