// @include shared/ai.js
// @include shared/build-rules.js
// @include shared/input.js
// Body:
//   { action: "save_draft", build_id?, client_id, customer_id, template, name,
//     daily_budget, bidding_strategy, geo_targets, ad_groups }   (FF staff or Rob)
//   { action: "delete_draft", build_id }                          (FF staff or Rob)
//   { action: "build", build_id }                                 (rob_admin only)
// Input: the ad_accounts row for customer_id (to check it belongs to client_id).
const b = requestBody();
const user = caller();
const acct = $input.first().json || {};

if (b.action === 'build') {
  if (user.role !== 'rob_admin') return reject(403, 'Only Rob (rob_admin) can build campaigns in Google Ads.');
  if (!isUuid(b.build_id)) return reject(400, 'build_id is missing or not valid.');
  return [{ json: { valid: true, route: 'build', build_id: b.build_id } }];
}

if (b.action === 'delete_draft') {
  if (!isUuid(b.build_id)) return reject(400, 'build_id is missing or not valid.');
  return [{
    json: {
      valid: true, route: 'write', method: 'DELETE', prefer: 'return=minimal', body: {},
      path: `campaign_builds?id=eq.${b.build_id}&status=in.(draft,error)`,
    },
  }];
}

if (b.action !== 'save_draft') return reject(400, 'action must be save_draft, delete_draft or build.');
if (!isUuid(b.client_id)) return reject(400, 'client_id is missing or not valid.');
const cid = customerId(b.customer_id);
if (!cid) return reject(400, 'Pick the Google Ads account.');
if (acct.customer_id !== cid || acct.client_id !== b.client_id) return reject(400, 'That Google Ads account does not belong to this client.');

const { issues, clean } = checkDraft(b);
if (!clean.template || clean.name.length < 3 || !clean.daily_budget_micros) {
  return reject(400, issues.join(' '));
}
const row = {
  client_id: b.client_id,
  customer_id: cid,
  ...clean,
  status: 'draft',
  error: null,
};
if (isUuid(b.build_id)) {
  return [{
    json: {
      valid: true, route: 'write', method: 'PATCH', prefer: 'return=representation', body: row, issues,
      path: `campaign_builds?id=eq.${b.build_id}&status=in.(draft,error)`,
    },
  }];
}
return [{
  json: {
    valid: true, route: 'write', method: 'POST', prefer: 'return=representation', issues,
    path: 'campaign_builds', body: { ...row, created_by: user.user_id },
  },
}];
