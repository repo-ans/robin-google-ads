// @include shared/gads.js
// Outcome of a build -> write_log, the draft's status, and the webhook answer.
const plan = $('Plan build').first().json;
const user = $('Auth: check role').first().json.user;
const ran = (name) => {
  try {
    return $(name).first().json;
  } catch (e) {
    return null;
  }
};
const ops = ran('Build operations');
const validation = ran('Validate build');
const created = ran('Create campaign');
const ctx = plan.ctx || {};
const acct = ctx.account || {};
const NOOP = { method: 'GET', path: 'clients?select=id&limit=0', body: null };

const logRow = (validateOnly, status, response) => ({
  actor_id: user.user_id, actor_role: user.role, customer_id: acct.customer_id,
  is_test_account: Boolean(acct.is_test_account), workflow: 'ff-build-campaign', operation: 'build_campaign',
  validate_only: validateOnly,
  request: { build_id: plan.build_id || (ctx.build && ctx.build.id) || null, operations: ops ? ops.op_count : 0 },
  response, status,
});
const out = (writes, respond) => (writes.length ? writes : [NOOP]).map((w) => ({ json: { ...w, respond } }));
const logWrite = (rows) => ({ method: 'POST', path: 'write_log', prefer: 'return=minimal', body: rows });
const buildPatch = (body) => ({
  method: 'PATCH', path: `campaign_builds?id=eq.${plan.build_id}`, prefer: 'return=minimal', body,
});

if (!plan.ok) {
  const writes = acct.customer_id ? [logWrite([logRow(false, 'refused', { error: plan.error })])] : [];
  return out(writes, { status: plan.status, body: { error: plan.error } });
}

const validateError = gadsError(validation);
if (validateError) {
  return out([
    logWrite([logRow(true, 'failed', { error: validateError })]),
    buildPatch({ status: 'error', error: `Google Ads rejected the build: ${validateError}` }),
  ], { status: 422, body: { error: `Google Ads rejected the build: ${validateError}` } });
}

const createError = gadsError(created);
if (createError) {
  return out([
    logWrite([logRow(true, 'ok', { validated: true }), logRow(false, 'failed', { error: createError })]),
    buildPatch({ status: 'error', error: `Google Ads did not create the campaign: ${createError}` }),
  ], { status: 502, body: { error: `Google Ads did not create the campaign: ${createError}` } });
}

const responses = (gadsBody(created) || {}).mutateOperationResponses || [];
const resources = { ad_groups: [], ads: 0, keywords: 0 };
for (const r of responses) {
  if (r.campaignResult) resources.campaign = r.campaignResult.resourceName;
  if (r.campaignBudgetResult) resources.budget = r.campaignBudgetResult.resourceName;
  if (r.sharedSetResult) resources.negative_list = r.sharedSetResult.resourceName;
  if (r.adGroupResult) resources.ad_groups.push(r.adGroupResult.resourceName);
  if (r.adGroupAdResult) resources.ads++;
  if (r.adGroupCriterionResult) resources.keywords++;
}
resources.reused_negative_list = Boolean(ops && ops.reused_negative_list);

return out([
  logWrite([logRow(true, 'ok', { validated: true }), logRow(false, 'ok', resources)]),
  buildPatch({ status: 'built', resources, error: null, built_at: new Date().toISOString(), built_by: user.user_id }),
], {
  status: 200,
  body: { ok: true, resources, message: 'Campaign created PAUSED. Run Sync now to see it in the dashboard; only Rob can enable it.' },
});
