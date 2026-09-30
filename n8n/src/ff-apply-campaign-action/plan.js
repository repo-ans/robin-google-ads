// @include shared/ai.js
// Builds the Google Ads change for a proposed action, after the guards:
//   - the action is still "proposed" (applied or dismissed ones cannot run twice)
//   - write gate: the account is a Google Ads test account, or rob_admin has
//     turned writes on for this client (Rob's SOP: test account first)
//   - a shared budget is never changed from one campaign
//   - pause only an enabled campaign, resume only a paused one
// Output { ok: false, status, error } stops here; the refusal is logged.
const cfg = $('Config').first().json;
const v = $('Validate input').first().json;
const ctx = $input.first().json || {};

const refuse = (status, error) => [{ json: { ok: false, status, error, ctx } }];

if (!ctx.found) return refuse(404, 'That proposed change was not found.');
if (ctx.action_status !== 'proposed') return refuse(409, `This change is already ${ctx.action_status || 'closed'}.`);
const action = normalizeAction(ctx.proposed_action);
if (!action) return refuse(422, 'The proposed change is not one of the supported actions.');
if (!ctx.campaign_row_id) return refuse(404, 'The campaign is no longer in the dashboard.');
if (!ctx.is_test_account && !ctx.writes_enabled) {
  return refuse(403, 'Writes are not turned on for this client yet. Test on the Google Ads test account first, then Rob can turn writes on in the client settings.');
}

const cid = ctx.customer_id;
let urlSuffix;
let operation;
let campaignPatch;
if (action.action_type === 'update_daily_budget') {
  if (!ctx.budget_id) return refuse(422, 'This campaign has no budget on file. Run a sync first.');
  if (ctx.budget_shared) return refuse(422, 'This campaign uses a shared budget. Change it in Google Ads so other campaigns are not affected by surprise.');
  const micros = Math.round(action.daily_budget * 1e6);
  urlSuffix = 'campaignBudgets:mutate';
  operation = {
    update: { resourceName: `customers/${cid}/campaignBudgets/${ctx.budget_id}`, amountMicros: String(micros) },
    updateMask: 'amountMicros',
  };
  campaignPatch = { budget_micros: micros };
} else {
  const target = action.action_type === 'pause_campaign' ? 'PAUSED' : 'ENABLED';
  if (action.action_type === 'pause_campaign' && ctx.campaign_status !== 'ENABLED') return refuse(409, 'The campaign is not running.');
  if (action.action_type === 'resume_campaign' && ctx.campaign_status !== 'PAUSED') return refuse(409, 'The campaign is not paused.');
  urlSuffix = 'campaigns:mutate';
  operation = {
    update: { resourceName: `customers/${cid}/campaigns/${ctx.campaign_id}`, status: target },
    updateMask: 'status',
  };
  campaignPatch = { status: target };
}

return [{
  json: {
    ok: true,
    ctx,
    action,
    customer_id: cid,
    login_customer_id: ctx.login_customer_id || null,
    api_version: cfg.GOOGLE_ADS_API_VERSION,
    url_suffix: urlSuffix,
    mutate_body: { operations: [operation] },
    campaign_patch: campaignPatch,
    source: v.source,
    source_id: v.source_id,
  },
}];
