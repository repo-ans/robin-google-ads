// @include shared/gads.js
// Runs after any outcome: refused by the guards, rejected by Google's
// validate-only call, failed, or applied. Emits the Supabase writes
// (write_log always; campaign + source row only on success) and carries the
// webhook answer in `respond`.
const plan = $('Plan change').first().json;
const user = $('Auth: check role').first().json.user;
const ran = (name) => {
  try {
    return $(name).first().json;
  } catch (e) {
    return null; // node did not run on this path
  }
};
const validation = ran('Validate change');
const applied = ran('Apply change');
const ctx = plan.ctx || {};
const NOOP = { method: 'GET', path: 'clients?select=id&limit=0', body: null };

const logRow = (validateOnly, status, response) => ({
  actor_id: user.user_id,
  actor_role: user.role,
  customer_id: ctx.customer_id,
  is_test_account: Boolean(ctx.is_test_account),
  workflow: 'ff-apply-campaign-action',
  operation: (plan.action && plan.action.action_type) || (ctx.proposed_action && ctx.proposed_action.action_type) || 'unknown',
  validate_only: validateOnly,
  request: plan.mutate_body || { proposed_action: ctx.proposed_action || null },
  response,
  status,
});
const out = (writes, respond) => (writes.length ? writes : [NOOP]).map((w) => ({ json: { ...w, respond } }));
const logWrite = (rows) => ({ method: 'POST', path: 'write_log', prefer: 'return=minimal', body: rows });

if (!plan.ok) {
  const writes = ctx.customer_id ? [logWrite([logRow(false, 'refused', { error: plan.error })])] : [];
  return out(writes, { status: plan.status, body: { error: plan.error } });
}

// Google sign-in first: without an access token every call below is a 401.
const token = ran('Refresh Google token');
if (token && !token.access_token) {
  const why = [token.error, token.error_description].filter(Boolean).join(' - ') || 'no access token';
  return out([logWrite([logRow(true, 'failed', { error: `Google sign-in failed: ${why}` })])], {
    status: 502,
    body: { error: `Google sign-in failed (${why}). Open Settings > Test connection; if it fails, press Connect with Google again.` },
  });
}

// ---- Call tracking setup: step A (one or two requests) and step B (call asset)
if (plan.source === 'tracking') {
  const ranAll = (name) => {
    try {
      return $(name).all();
    } catch (e) {
      return [];
    }
  };
  const logs = [];
  const errors = [];
  const record = (node, isValidate, labelOf) => {
    ranAll(node).forEach((item, i) => {
      const err = gadsError(item.json);
      const label = labelOf(i);
      logs.push({ ...logRow(isValidate, err ? 'failed' : 'ok', err ? { error: err } : gadsBody(item.json)), request: { step: label } });
      if (err) errors.push(`${label}: ${err}`);
    });
  };
  const labelA = (node) => (i) => {
    try {
      return $(node).itemMatching(i).json.label;
    } catch (e) {
      return 'step A';
    }
  };
  record('Validate tracking', true, labelA('Tracking: requests'));
  record('Apply tracking', false, labelA('Tracking: real requests'));
  record('Validate call asset', true, () => 'call asset');
  record('Apply call asset', false, () => 'call asset');
  const assetPlan = ran('Plan call asset');
  if (assetPlan && assetPlan.failed) errors.push(assetPlan.reason);

  const appliedA = ranAll('Apply tracking').length > 0;
  const appliedAsset = ranAll('Apply call asset').some((item) => !gadsError(item.json));
  const changed = appliedA || appliedAsset;
  const respond = errors.length
    ? { status: changed ? 502 : 422, body: { error: `Call tracking ${changed ? 'was only partly set up' : 'was not set up'}: ${errors.join(' | ').slice(0, 400)}`, steps: plan.action.steps } }
    : { status: 200, body: { ok: true, steps: plan.action.steps, note: 'Done. The dashboard shows it after the next sync.' } };
  return out(logs.length ? [logWrite(logs)] : [], respond);
}

const validateError = gadsError(validation);
if (validateError) {
  return out([logWrite([logRow(true, 'failed', { error: validateError })])],
    { status: 422, body: { error: `Google Ads rejected the change: ${validateError}` } });
}

const applyError = gadsError(applied);
const validatedRow = logRow(true, 'ok', gadsBody(validation));
if (applyError) {
  return out([logWrite([validatedRow, logRow(false, 'failed', { error: applyError })])],
    { status: 502, body: { error: `The change passed validation but Google Ads did not apply it: ${applyError}` } });
}

if (plan.source === 'neglist') {
  return out([logWrite([validatedRow, logRow(false, 'ok', gadsBody(applied))])],
    { status: 200, body: { ok: true, steps: plan.action.steps, note: 'Done. The dashboard shows it after the next sync.' } });
}

if (plan.source === 'negatives') {
  // Only the log here: the new negatives arrive in the negatives table (and the
  // "Already negative" column) with the next sync.
  const a = plan.action;
  return out([logWrite([validatedRow, logRow(false, 'ok', gadsBody(applied))])],
    { status: 200, body: { ok: true, added: a.terms.length, skipped: a.skipped, level: a.level } });
}

const sourcePath = plan.source === 'chat'
  ? `campaign_chat_messages?id=eq.${plan.source_id}&action_status=eq.proposed`
  : `message_drafts?message_id=eq.${plan.source_id}&action_status=eq.proposed`;

return out([
  logWrite([validatedRow, logRow(false, 'ok', gadsBody(applied))]),
  // Write the new value straight back so the dashboard is right before the next
  // sync (reference fix: "applied a $2 budget, dashboard still showed $1").
  { method: 'PATCH', path: `campaigns?customer_id=eq.${ctx.customer_id}&campaign_id=eq.${ctx.campaign_id}`,
    prefer: 'return=minimal', body: plan.campaign_patch },
  { method: 'PATCH', path: sourcePath, prefer: 'return=minimal', body: { action_status: 'applied' } },
], { status: 200, body: { ok: true, applied: plan.action } });
