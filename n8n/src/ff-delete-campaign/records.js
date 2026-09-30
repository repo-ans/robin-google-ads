// @include shared/gads.js
// Outcome of a removal -> write_log + soft-remove in Supabase + webhook answer.
// OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE counts as success: the campaign
// is already gone in Google Ads, so the dashboard should say so too
// (reference lesson from delete-campaign "Check removal result").
const plan = $('Plan removal').first().json;
const user = $('Auth: check role').first().json.user;
const ran = (name) => {
  try {
    return $(name).first().json;
  } catch (e) {
    return null;
  }
};
const validation = ran('Validate removal');
const removal = ran('Remove campaign');
const c = plan.c || {};
const NOOP = { method: 'GET', path: 'clients?select=id&limit=0', body: null };
const already = (r) => r && JSON.stringify(r).includes('OPERATION_NOT_PERMITTED_FOR_REMOVED_RESOURCE');

const logRow = (validateOnly, status, response) => ({
  actor_id: user.user_id, actor_role: user.role, customer_id: c.customer_id,
  is_test_account: Boolean(plan.is_test_account), workflow: 'ff-delete-campaign', operation: 'remove_campaign',
  validate_only: validateOnly, request: plan.mutate_body || { campaign_id: c.campaign_id || null }, response, status,
});
const out = (writes, respond) => (writes.length ? writes : [NOOP]).map((w) => ({ json: { ...w, respond } }));
const logWrite = (rows) => ({ method: 'POST', path: 'write_log', prefer: 'return=minimal', body: rows });

if (!plan.ok) {
  const writes = c.customer_id ? [logWrite([logRow(false, 'refused', { error: plan.error })])] : [];
  return out(writes, { status: plan.status, body: { error: plan.error } });
}

const validateError = already(validation) ? null : gadsError(validation);
if (validateError) {
  return out([logWrite([logRow(true, 'failed', { error: validateError })])],
    { status: 422, body: { error: `Google Ads would not remove the campaign: ${validateError}` } });
}
const removeError = removal && !already(removal) ? gadsError(removal) : null;
if (removeError) {
  return out([logWrite([logRow(true, 'ok', gadsBody(validation)), logRow(false, 'failed', { error: removeError })])],
    { status: 502, body: { error: `Google Ads did not remove the campaign: ${removeError}` } });
}

const now = new Date().toISOString();
return out([
  logWrite([logRow(true, 'ok', gadsBody(validation)), logRow(false, 'ok', gadsBody(removal) || { already_removed: true })]),
  { method: 'PATCH', path: `campaigns?customer_id=eq.${c.customer_id}&campaign_id=eq.${c.campaign_id}`,
    prefer: 'return=minimal', body: { status: 'REMOVED', removed_at: now } },
], { status: 200, body: { ok: true } });
