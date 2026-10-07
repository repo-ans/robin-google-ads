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

if (!ctx.found) return refuse(404, v.source === 'negatives' ? 'That campaign was not found.' : 'That proposed change was not found.');

// ---- Negative keywords from the Search Terms tab (PDF task 5)
if (v.source === 'negatives') {
  if (!ctx.is_test_account && !ctx.writes_enabled) {
    return refuse(403, 'Writes are not turned on for this client yet. Test on the Google Ads test account first, then Rob can turn writes on in the client settings.');
  }
  const cid = ctx.customer_id;
  const toList = v.level === 'list';
  if (toList && !ctx.universal_list_id) {
    return refuse(422, 'This account has no "FF - Funeral universal negatives" list yet. Rob can add it on the client page (Blocked searches > Set up blocked-words list), or add to the campaign instead.');
  }
  const norm = (t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
  const existing = new Set(toList ? ctx.existing_list_negatives || [] : ctx.existing_campaign_negatives || []);
  const fresh = v.terms.filter((t) => !existing.has(`${norm(t)}|${v.match_type}`));
  const skipped = v.terms.length - fresh.length;
  if (fresh.length === 0) return refuse(409, 'All of these are already negative keywords there.');
  const keyword = (t) => ({ text: t, matchType: v.match_type });
  const operations = toList
    ? fresh.map((t) => ({ create: { sharedSet: `customers/${cid}/sharedSets/${ctx.universal_list_id}`, keyword: keyword(t) } }))
    : fresh.map((t) => ({ create: { campaign: `customers/${cid}/campaigns/${ctx.campaign_id}`, negative: true, keyword: keyword(t) } }));
  return [{
    json: {
      ok: true,
      ctx,
      action: { action_type: 'add_negatives', level: v.level, match_type: v.match_type, terms: fresh, skipped },
      customer_id: cid,
      login_customer_id: ctx.login_customer_id || null,
      api_version: cfg.GOOGLE_ADS_API_VERSION,
      url_suffix: toList ? 'sharedCriteria:mutate' : 'campaignCriteria:mutate',
      mutate_body: { operations },
      campaign_patch: null,
      source: v.source,
      source_id: v.source_id,
    },
  }];
}

// ---- Blocked-words list for one account (PDF task 5), any client, one click by Rob
// One atomic googleAds:mutate: create "FF - Funeral universal negatives" if the
// account has none, add the FF words that are missing plus the client's own name
// and competitors, and attach the list to every search campaign without it.
// Campaigns built later get it from ff-build-campaign.
if (v.source === 'neglist') {
  if (!ctx.is_test_account && !ctx.writes_enabled) {
    return refuse(403, 'Writes are not turned on for this client yet. Test on the Google Ads test account first, then Rob can turn writes on in the client settings.');
  }
  const n = ctx.neglist || {};
  const cid = ctx.customer_id;
  if (!n.last_synced_at) return refuse(409, 'Sync this account first, so the current lists and campaigns are known.');

  const clean = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9 '&.-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const usable = (x) => x && x.length <= 80 && x.split(' ').length <= 10;
  const words = [];
  const seen = new Set();
  const add = (text, matchType) => {
    const t = clean(text);
    const key = `${t}|${matchType}`;
    if (usable(t) && !seen.has(key)) {
      seen.add(key);
      words.push({ text: t, match_type: matchType });
    }
  };
  for (const u of n.universal || []) add(u.text, u.match_type);
  // Robin: block the client's own name and competitors' names too (phrase match).
  const brand = (n.own_brand_terms || []).length ? n.own_brand_terms : [n.client_name];
  for (const b of brand) add(b, 'PHRASE');
  for (const c of n.competitor_terms || []) add(c, 'PHRASE');

  const have = new Set(n.list_terms || []);
  const missing = words.filter((w) => !have.has(`${w.text}|${w.match_type}`));
  const unlinked = (n.campaigns || []).filter((k) => !k.linked);

  const ops = [];
  let list = n.list_id ? `customers/${cid}/sharedSets/${n.list_id}` : null;
  const steps = [];
  if (!list) {
    list = `customers/${cid}/sharedSets/-1`;
    ops.push({ sharedSetOperation: { create: { resourceName: list, name: 'FF - Funeral universal negatives', type: 'NEGATIVE_KEYWORDS' } } });
    steps.push('Created the list "FF - Funeral universal negatives"');
  }
  for (const w of missing) {
    ops.push({ sharedCriterionOperation: { create: { sharedSet: list, keyword: { text: w.text, matchType: w.match_type } } } });
  }
  if (missing.length) steps.push(`Added ${missing.length} blocked word(s)`);
  for (const k of unlinked) {
    ops.push({ campaignSharedSetOperation: { create: { campaign: `customers/${cid}/campaigns/${k.id}`, sharedSet: list } } });
  }
  if (unlinked.length) steps.push(`Attached it to ${unlinked.length} campaign(s): ${unlinked.map((k) => k.name).join(', ').slice(0, 300)}`);
  if (!ops.length) return refuse(409, 'The blocked-words list is already complete and on every search campaign.');

  return [{
    json: {
      ok: true,
      ctx,
      action: { action_type: 'setup_negative_list', steps, added: missing.length, campaigns: unlinked.length },
      customer_id: cid,
      login_customer_id: ctx.login_customer_id || null,
      api_version: cfg.GOOGLE_ADS_API_VERSION,
      url_suffix: 'googleAds:mutate',
      mutate_body: { mutateOperations: ops },
      campaign_patch: null,
      source: v.source,
      source_id: v.source_id,
    },
  }];
}

// ---- Call tracking setup for one account (PDF task 2), any client, one click by Rob
// Step A (this plan): account settings + the two 90-second call conversion actions.
// Step B ("Plan call asset", after step A is applied): an account-level call asset
// with the business number, counted by "Calls from ads 90s+". Account level means
// every campaign shows it, including campaigns built later.
if (v.source === 'tracking') {
  if (!ctx.is_test_account && !ctx.writes_enabled) {
    return refuse(403, 'Writes are not turned on for this client yet. Test on the Google Ads test account first, then Rob can turn writes on in the client settings.');
  }
  const t = ctx.tracking || {};
  const cid = ctx.customer_id;
  if (!t.last_synced_at) return refuse(409, 'Sync this account first, so the current settings are known.');

  const digits = String(t.client_phone || t.asset_phone || '').replace(/\D/g, '');
  const national = digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits;
  const phone = national.length === 10 ? `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}` : null;
  // A call asset is needed only when no account-level one exists and some enabled
  // search campaign has none of its own (campaign-level assets already count).
  const needAsset = !Number(t.account_call_assets) && Number(t.search_campaigns_without_call_asset ?? 1) > 0;
  // Business numbers here are US or Canada; the account currency tells them apart.
  const countryCode = t.currency_code === 'CAD' ? 'CA' : 'US';
  if (needAsset && !phone) return refuse(422, 'No business phone found - add the funeral home\'s number (US or Canada, 10 digits) under Edit client > Business phone.');

  const steps = [];
  const requestsA = [];
  if (!t.call_reporting_enabled || !t.call_conversion_reporting_enabled || !t.auto_tagging_enabled) {
    requestsA.push({
      label: 'account',
      url_suffix: ':mutate',
      body: {
        operation: {
          update: {
            resourceName: `customers/${cid}`,
            autoTaggingEnabled: true,
            callReportingSetting: { callReportingEnabled: true, callConversionReportingEnabled: true },
          },
          updateMask: 'autoTaggingEnabled,callReportingSetting.callReportingEnabled,callReportingSetting.callConversionReportingEnabled',
        },
      },
    });
    steps.push('Call reporting and auto-tagging turned on');
  }

  const actions = t.call_actions || [];
  const value = t.case_value_micros ? Number(t.case_value_micros) / 1e6 : null;
  const ops = [];
  const opTypes = [];
  let adCallAction = null;
  for (const [type, name] of [['AD_CALL', 'Calls from ads 90s+'], ['WEBSITE_CALL', 'Calls from website 90s+']]) {
    const good = actions.find((a) => a.type === type && a.status === 'ENABLED' && Number(a.seconds) === 90);
    if (good) {
      if (type === 'AD_CALL') adCallAction = `customers/${cid}/conversionActions/${good.id}`;
      continue;
    }
    // The account already counts this kind of call (often at a shorter length):
    // set those actions to 90 seconds instead of adding a second action, so one
    // call is never counted twice.
    const existing = actions.filter((a) => a.type === type && a.status === 'ENABLED');
    const ours = actions.find((a) => a.type === type && a.name === name);
    const toFix = existing.length ? existing : ours ? [ours] : [];
    if (toFix.length) {
      for (const a of toFix) {
        ops.push({
          update: { resourceName: `customers/${cid}/conversionActions/${a.id}`, status: 'ENABLED', phoneCallDurationSeconds: 90 },
          updateMask: 'status,phoneCallDurationSeconds',
        });
        opTypes.push(type);
        steps.push(`"${a.name}" now counts calls of 90 seconds or more (was ${a.seconds ?? 'the default'})`);
      }
      if (type === 'AD_CALL') adCallAction = `customers/${cid}/conversionActions/${toFix[0].id}`;
      continue;
    }
    ops.push({
      create: {
        name, type, category: 'PHONE_CALL_LEAD', status: 'ENABLED', primaryForGoal: true,
        countingType: 'ONE_PER_CLICK', phoneCallDurationSeconds: 90,
        ...(value ? { valueSettings: { defaultValue: value, alwaysUseDefaultValue: true, ...(t.currency_code ? { defaultCurrencyCode: t.currency_code } : {}) } } : {}),
      },
    });
    opTypes.push(type);
    steps.push(`"${name}" created (90 seconds, primary)`);
  }
  // The monthly case match uploads signed cases to "Case signed" (Robin's name).
  // Secondary goal: it is reported, but bidding is not switched to it - that is Rob's call.
  for (const [type, name] of [['UPLOAD_CLICKS', 'Case signed'], ['UPLOAD_CALLS', 'Case signed - calls']]) {
    const have = actions.find((a) => a.type === type && a.status === 'ENABLED' && /^(case signed|ff - signed case)/i.test(a.name || ''));
    if (have) continue;
    ops.push({
      create: {
        name, type, category: 'CONVERTED_LEAD', status: 'ENABLED', primaryForGoal: false, countingType: 'ONE_PER_CLICK',
        ...(value ? { valueSettings: { defaultValue: value, alwaysUseDefaultValue: false, ...(t.currency_code ? { defaultCurrencyCode: t.currency_code } : {}) } } : {}),
      },
    });
    opTypes.push(type);
    steps.push(`"${name}" created for the monthly case match`);
  }
  // Website actions by the client's process (tasks 3 and 7). Their AW-.../label
  // values reach the dashboard's "Copy website script" with the next sync.
  const websiteActions = t.process === 'online_cremation'
    ? [
      ['PURCHASE', 'Online arrangement paid', { primaryForGoal: true, countingType: 'MANY_PER_CLICK' }],
      ['BEGIN_CHECKOUT', 'Arrangement started', { primaryForGoal: false, countingType: 'ONE_PER_CLICK' }],
    ]
    : [['SUBMIT_LEAD_FORM', 'Preplanning form', { primaryForGoal: true, countingType: 'ONE_PER_CLICK' }]];
  for (const [category, name, extra] of websiteActions) {
    if (actions.some((a) => a.type === 'WEBPAGE' && a.category === category && a.status === 'ENABLED')) continue;
    ops.push({
      create: {
        name, type: 'WEBPAGE', category, status: 'ENABLED', ...extra,
        ...(category === 'PURCHASE'
          ? { valueSettings: { ...(value ? { defaultValue: value } : {}), alwaysUseDefaultValue: false, ...(t.currency_code ? { defaultCurrencyCode: t.currency_code } : {}) } }
          : {}),
      },
    });
    opTypes.push('WEBPAGE');
    steps.push(`"${name}" created for the website`);
  }
  if (ops.length) requestsA.push({ label: 'conversion_actions', url_suffix: '/conversionActions:mutate', op_types: opTypes, body: { operations: ops } });
  if (needAsset) steps.push(`Call asset ${phone} added to the whole account (every campaign shows it)`);

  if (!requestsA.length && !needAsset) return refuse(409, 'Call tracking is already set up for this account.');

  return [{
    json: {
      ok: true,
      ctx,
      action: { action_type: 'setup_call_tracking', steps },
      customer_id: cid,
      login_customer_id: ctx.login_customer_id || null,
      api_version: cfg.GOOGLE_ADS_API_VERSION,
      mutate_body: { steps },
      campaign_patch: null,
      source: v.source,
      source_id: v.source_id,
      tracking: { requests_a: requestsA, ad_call_action: adCallAction, need_asset: needAsset, phone, country_code: countryCode },
    },
  }];
}

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
