// @include shared/ai.js
// @include shared/build-rules.js
// Guards before anything is sent to Google Ads:
//   - the draft exists and is not already built / being built
//   - write gate: Google Ads test account, or writes turned on for the client
//   - the draft passes every SOP rule (checkDraft has no issues)
const cfg = $('Config').first().json;
const ctx = $input.first().json || {};
const refuse = (status, error) => [{ json: { ok: false, status, error, ctx } }];

if (!ctx.build) return refuse(404, 'Draft not found.');
const build = ctx.build;
const acct = ctx.account || {};
const client = ctx.client || {};
if (!['draft', 'error'].includes(build.status)) return refuse(409, `This draft is already ${build.status}.`);
if (!acct.is_test_account && !client.writes_enabled) {
  return refuse(403, 'Writes are not turned on for this client yet. Build on the Google Ads test account first, then Rob can turn writes on in the client settings.');
}

const { issues, clean } = checkDraft({ ...build, daily_budget: Number(build.daily_budget_micros) / 1e6 });
if (issues.length) return refuse(422, `Fix these first: ${issues.join(' ')}`);

return [{
  json: {
    ok: true,
    ctx,
    clean,
    build_id: build.id,
    customer_id: acct.customer_id,
    login_customer_id: acct.login_customer_id || null,
    is_test_account: Boolean(acct.is_test_account),
    api_version: cfg.GOOGLE_ADS_API_VERSION,
  },
}];
