// @include shared/gads.js
// @include ff-case-match/results.js
// Runs after any outcome (refused, checked, uploaded, failed). Emits the
// Supabase writes - one case_match_runs row (counts only) and the write_log
// rows (summaries only) - and carries the webhook answer in `respond`.
// Nothing from the case list is written: no click ids, emails, phones or dates.
const v = $('Validate input').first().json;
const plan = $('Plan uploads').first().json;
const user = $('Auth: check role').first().json.user;
const ran = (name) => {
  try {
    return $(name).all();
  } catch (e) {
    return null; // node did not run on this path
  }
};
const ctx = plan.ctx || {};
const counts = plan.counts || { cases_in: (v.cases || []).length };
const monthStart = `${v.month}-01`;

const checkItems = ran('Check validation');
const checked = checkItems && checkItems[0] ? checkItems[0].json.results : null;
const uploadItems = ran('Upload conversions');
let uploaded = null;
if (uploadItems && uploadItems.length) {
  uploaded = {};
  uploadItems.forEach((item, i) => {
    const req = $('Real upload requests').itemMatching(i).json;
    uploaded[req.kind] = readUpload(item.json, req.sent);
  });
}

const final = uploaded || checked || {};
const reasons = { ...(plan.reasons || {}) };
let accepted = 0;
let rejected = 0;
const errors = [];
for (const r of Object.values(final)) {
  accepted += r.accepted;
  rejected += r.rejected;
  for (const [k, n] of Object.entries(r.reasons)) reasons[k] = (reasons[k] || 0) + n;
  if (r.error) errors.push(r.error);
}

const validateOnly = !uploaded;
let status;
let error = null;
if (!plan.ok) {
  status = 'refused';
  error = plan.error;
} else if (errors.length) {
  status = 'failed';
  error = errors.join(' | ').slice(0, 500);
} else {
  status = rejected > 0 || counts.skipped > 0 ? 'partial' : 'ok';
}

const runRow = {
  client_id: v.client_id,
  customer_id: v.customer_id,
  month: monthStart,
  validate_only: validateOnly,
  cases_in: counts.cases_in || 0,
  skipped: counts.skipped || 0,
  matched: counts.matched || 0,
  unattributed: counts.unattributed || 0,
  case_types: counts.case_types || {},
  sent_click: counts.sent_click || 0,
  sent_call: counts.sent_call || 0,
  accepted,
  rejected,
  reasons,
  value_total: counts.value_total || 0,
  currency_code: ctx.currency_code || null,
  status,
  error,
  run_by: user.user_id,
};

const logRow = (kind, isValidate, r) => ({
  actor_id: user.user_id,
  actor_role: user.role,
  customer_id: v.customer_id,
  is_test_account: Boolean(ctx.is_test_account),
  workflow: 'ff-case-match',
  operation: `upload_${kind}_conversions`,
  validate_only: isValidate,
  request: { month: v.month, conversions: r.sent },
  response: { accepted: r.accepted, rejected: r.rejected, reasons: r.reasons, error: r.error },
  status: r.error ? 'failed' : 'ok',
});
const logs = [];
if (plan.ok) {
  for (const [kind, r] of Object.entries(checked || {})) logs.push(logRow(kind, true, r));
  for (const [kind, r] of Object.entries(uploaded || {})) logs.push(logRow(kind, false, r));
} else if (ctx.customer_id && v.action === 'upload') {
  logs.push({ ...logRow('case', false, { sent: 0, accepted: 0, rejected: 0, reasons: {}, error: plan.error }), status: 'refused' });
}

const writes = [];
if (ctx.found && ctx.customer_id) writes.push({ method: 'POST', path: 'case_match_runs', prefer: 'return=minimal', body: runRow });
if (logs.length) writes.push({ method: 'POST', path: 'write_log', prefer: 'return=minimal', body: logs });
if (!writes.length) writes.push({ method: 'GET', path: 'clients?select=id&limit=0', body: null });

const summary = {
  ok: plan.ok && !errors.length,
  uploaded: !validateOnly,
  cases_in: runRow.cases_in,
  matched: runRow.matched,
  unattributed: runRow.unattributed,
  case_types: runRow.case_types,
  skipped: runRow.skipped,
  sent: runRow.sent_click + runRow.sent_call,
  accepted,
  rejected,
  reasons,
};
const respond = !plan.ok
  ? { status: plan.status || 400, body: { error: plan.error, ...summary } }
  : errors.length
    ? { status: 502, body: { error: `Google Ads did not take the upload: ${error}`, ...summary } }
    : { status: 200, body: summary };

return writes.map((w) => ({ json: { ...w, respond } }));
