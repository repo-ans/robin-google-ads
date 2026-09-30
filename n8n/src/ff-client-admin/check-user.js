// Result of POST /auth/v1/admin/users. The password is never echoed back.
const r = $input.first().json || {};
const body = r.body || {};
if (r.statusCode >= 200 && r.statusCode < 300 && body.id) {
  return [{ json: { ok: true, user_id: body.id } }];
}
const detail = String(body.msg || body.message || body.error_description || body.error || `status ${r.statusCode}`);
const exists = /already|registered|exists/i.test(detail);
return [{
  json: {
    ok: false,
    status: exists ? 409 : 502,
    body: { error: exists ? 'A login with that email already exists.' : `Could not create the login: ${detail.slice(0, 200)}` },
  },
}];
