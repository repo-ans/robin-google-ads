// Result of inserting the profiles row. If it failed, the auth user just
// created is deleted next ("Remove auth user"), so no login exists without a role.
const r = $input.first().json || {};
const plan = $('Plan').first().json;
const created = $('Check user').first().json;
if (r.statusCode >= 200 && r.statusCode < 300) {
  return [{
    json: {
      ok: true,
      status: 200,
      body: { ok: true, message: 'Login created.', data: { user_id: created.user_id, email: plan.email, role: plan.role } },
    },
  }];
}
const body = r.body || {};
return [{
  json: {
    ok: false,
    user_id: created.user_id,
    status: 502,
    body: { error: `The login could not be finished and was removed again: ${String(body.message || r.statusCode).slice(0, 200)}` },
  },
}];
