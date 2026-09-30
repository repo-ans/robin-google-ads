const r = $input.first().json || {};
const ok = r.statusCode >= 200 && r.statusCode < 300;
return [{
  json: ok
    ? { status: 200, body: { ok: true, message: 'Connected with Google. The refresh token is saved.' } }
    : { status: 502, body: { error: 'Google connected, but the refresh token could not be saved. Try again.' } },
}];
