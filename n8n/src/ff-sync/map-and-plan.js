// @include shared/names.js
// @include shared/gads.js
// Turns every Google Ads response for this account into Supabase upserts.
//
// Input: one item per query from "Google Ads search" (HTTP, full response,
// text body). Each is matched to its query with itemMatching(i) - the paired
// item link from "Account: build queries" through the HTTP node - never by
// position (reference lesson: index pairing broke across sources).
//
// Output, in this order:
//   item 0 - start marker: upserts sync_run_accounts (status 'partial' until
//            "Finish account" overwrites it) and carries query_results.
//   items  - { table, on_conflict, rows } chunks of up to 500 rows.
// Every item is written by "Write rows" with a PostgREST upsert
// (on_conflict + resolution=merge-duplicates). No delete-then-create.
//
// Rules applied here:
//   - search terms pass the name filter before storage (hard rule 4, PLAN 5.4,
//     rules in shared/names.js)
//   - rows in one request all have the same keys (PostgREST requirement)
//   - duplicate natural keys inside a batch are merged (metrics summed),
//     otherwise Postgres rejects the upsert
//   - proto3 JSON omits false/0/empty, so booleans default to false and
//     missing metrics to 0

const inputs = $input.all();
const meta0 = $('Account: build queries').itemMatching(0).json;
const cid = meta0.customer_id;
const ts = meta0.pass_at;
const tz = meta0.time_zone || 'UTC';
const account = $('Loop over accounts').first().json;

// ---------------------------------------------------------------- helpers
const num = (v) => (v === undefined || v === null || v === '' ? 0 : Number(v));
const numOrNull = (v) => (v === undefined || v === null || v === '' ? null : Number(v));
const str = (v) => (v === undefined || v === null ? null : String(v));
const lastPart = (rn) => (rn ? String(rn).split('/').pop() : null);
const tildeParts = (rn) => (rn ? String(rn).split('/').pop().split('~') : []);

// Google returns account-local times without a zone ("2026-09-29 14:03:11").
// Convert to UTC ISO using the account time zone.
function localToUtc(local) {
  if (!local) return null;
  const [d, t = '00:00:00'] = String(local).split(' ');
  const guess = new Date(`${d}T${t.slice(0, 8)}Z`);
  if (Number.isNaN(guess.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(guess);
    const get = (k) => Number(parts.find((p) => p.type === k).value);
    const asZone = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    return new Date(guess.getTime() - (asZone - guess.getTime())).toISOString();
  } catch (e) {
    return guess.toISOString();
  }
}

// ---------------------------------------------------------------- sha256
// Code nodes may not be allowed to require('crypto'), so a small pure-JS SHA-256.
function sha256(ascii) {
  const utf8 = encodeURIComponent(ascii).replace(/%([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  const K = [];
  const H = [];
  let prime = 2;
  const isPrime = (n) => { for (let f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
  const frac = (x) => ((x - Math.floor(x)) * 4294967296) | 0;
  while (K.length < 64) {
    if (isPrime(prime)) {
      if (H.length < 8) H.push(frac(Math.pow(prime, 1 / 2)));
      K.push(frac(Math.pow(prime, 1 / 3)));
    }
    prime++;
  }
  const bytes = [];
  for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 0xff);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const w = new Array(64);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

// ---------------------------------------------------------------- name filter
// Rules live in shared/names.js. Client towns, brand and competitor names are
// allowed words, so "mount pleasant cremation" or a competitor's name survive.
const { filterTerm } = makeNameFilters([
  ...(account.towns || []), ...(account.own_brand_terms || []), ...(account.competitor_terms || []),
]);

// ---------------------------------------------------------------- mappers
// Each returns a list of [table, row]. Row shapes are fixed per table.
const metricsBasic = (m = {}) => ({
  impressions: num(m.impressions), clicks: num(m.clicks), cost_micros: num(m.costMicros),
  conversions: num(m.conversions), conversions_value: num(m.conversionsValue),
});

const negativeRow = (level, scopeId, criterionId, campaignId, adGroupId, sharedSetId, kw = {}) => ({
  customer_id: cid, level, scope_id: String(scopeId), criterion_id: String(criterionId),
  campaign_id: campaignId, ad_group_id: adGroupId, shared_set_id: sharedSetId,
  text: kw.text || '', match_type: kw.matchType || null, removed_at: null, synced_at: ts,
});

function assetRow(level, scopeId, link = {}, a = {}, campaignId, adGroupId) {
  const sl = a.sitelinkAsset || {};
  const co = a.calloutAsset || {};
  const sn = a.structuredSnippetAsset || {};
  const call = a.callAsset || {};
  const text = sl.linkText || co.calloutText || (sn.header ? `${sn.header}: ${(sn.values || []).join(', ')}` : null);
  return {
    customer_id: cid, level, scope_id: String(scopeId), asset_id: str(a.id), field_type: link.fieldType || 'UNKNOWN',
    campaign_id: campaignId, ad_group_id: adGroupId, type: a.type || null, name: a.name || null,
    status: link.status || null, primary_status: link.primaryStatus || null, text,
    description1: sl.description1 || null, description2: sl.description2 || null,
    final_url: (a.finalUrls || [])[0] || null, phone_number: call.phoneNumber || null,
    call_conversion_reporting_state: call.callConversionReportingState || null,
    call_conversion_action: call.callConversionAction || null, removed_at: null, synced_at: ts,
  };
}

const MAP = {
  customer: (r) => {
    const c = r.customer || {};
    const crs = c.callReportingSetting || {};
    const cts = c.conversionTrackingSetting || {};
    return [['ad_accounts', {
      customer_id: cid, descriptive_name: c.descriptiveName || null, currency_code: c.currencyCode || null,
      time_zone: c.timeZone || null, is_manager: Boolean(c.manager), is_test_account: Boolean(c.testAccount),
      auto_tagging_enabled: Boolean(c.autoTaggingEnabled),
      call_reporting_enabled: Boolean(crs.callReportingEnabled),
      call_conversion_reporting_enabled: Boolean(crs.callConversionReportingEnabled),
      call_conversion_action: crs.callConversionAction || null,
      conversion_tracking_status: cts.conversionTrackingStatus || null,
      enhanced_conversions_for_leads: Boolean(cts.enhancedConversionsForLeadsEnabled),
      synced_at: ts,
    }]];
  },

  campaigns: (r) => {
    const c = r.campaign || {};
    const b = r.campaignBudget || {};
    const ns = c.networkSettings || {};
    const geo = c.geoTargetTypeSetting || {};
    return [['campaigns', {
      customer_id: cid, campaign_id: str(c.id), name: c.name || '', status: c.status || null,
      serving_status: c.servingStatus || null, primary_status: c.primaryStatus || null,
      primary_status_reasons: c.primaryStatusReasons || [],
      channel_type: c.advertisingChannelType || null, channel_sub_type: c.advertisingChannelSubType || null,
      bidding_strategy_type: c.biddingStrategyType || null,
      target_cpa_micros: numOrNull((c.targetCpa || {}).targetCpaMicros) || numOrNull((c.maximizeConversions || {}).targetCpaMicros),
      target_roas: numOrNull((c.targetRoas || {}).targetRoas) || numOrNull((c.maximizeConversionValue || {}).targetRoas),
      budget_id: str(b.id), budget_micros: numOrNull(b.amountMicros), budget_delivery: b.deliveryMethod || null,
      budget_shared: Boolean(b.explicitlyShared),
      network_search: Boolean(ns.targetGoogleSearch), network_partners: Boolean(ns.targetSearchNetwork),
      network_display: Boolean(ns.targetContentNetwork),
      positive_geo_target_type: geo.positiveGeoTargetType || null, negative_geo_target_type: geo.negativeGeoTargetType || null,
      removed_at: c.status === 'REMOVED' ? ts : null, synced_at: ts,
    }]];
  },

  campaign_criteria: (r) => {
    const cc = r.campaignCriterion || {};
    const campaignId = str((r.campaign || {}).id);
    if (cc.type === 'KEYWORD') {
      if (!cc.negative) return [];
      return [['negatives', negativeRow('campaign', campaignId, cc.criterionId, campaignId, null, null, cc.keyword)]];
    }
    const as = cc.adSchedule || {};
    const prox = cc.proximity || {};
    const hasSchedule = Boolean(as.dayOfWeek);
    return [['campaign_targets', {
      customer_id: cid, campaign_id: campaignId, criterion_id: str(cc.criterionId), type: cc.type || 'UNKNOWN',
      negative: Boolean(cc.negative), status: cc.status || null, bid_modifier: numOrNull(cc.bidModifier),
      geo_target_constant: (cc.location || {}).geoTargetConstant || null,
      radius: numOrNull(prox.radius), radius_units: prox.radiusUnits || null,
      language_constant: (cc.language || {}).languageConstant || null,
      day_of_week: as.dayOfWeek || null,
      start_hour: hasSchedule ? num(as.startHour) : null, start_minute: as.startMinute || (hasSchedule ? 'ZERO' : null),
      end_hour: hasSchedule ? num(as.endHour) : null, end_minute: as.endMinute || (hasSchedule ? 'ZERO' : null),
      device: (cc.device || {}).type || null, removed_at: null, synced_at: ts,
    }]];
  },

  ad_groups: (r) => {
    const g = r.adGroup || {};
    return [['ad_groups', {
      customer_id: cid, ad_group_id: str(g.id), campaign_id: str((r.campaign || {}).id), name: g.name || '',
      status: g.status || null, type: g.type || null, cpc_bid_micros: numOrNull(g.cpcBidMicros),
      removed_at: null, synced_at: ts,
    }]];
  },

  keywords: (r) => {
    const k = r.adGroupCriterion || {};
    const campaignId = str((r.campaign || {}).id);
    const adGroupId = str((r.adGroup || {}).id);
    if (k.negative) {
      return [['negatives', negativeRow('ad_group', adGroupId, k.criterionId, campaignId, adGroupId, null, k.keyword)]];
    }
    const qi = k.qualityInfo || {};
    const pe = k.positionEstimates || {};
    return [['keywords', {
      customer_id: cid, ad_group_id: adGroupId, criterion_id: str(k.criterionId), campaign_id: campaignId,
      text: (k.keyword || {}).text || '', match_type: (k.keyword || {}).matchType || null,
      status: k.status || null, system_serving_status: k.systemServingStatus || null,
      approval_status: k.approvalStatus || null, cpc_bid_micros: numOrNull(k.cpcBidMicros),
      effective_cpc_bid_micros: numOrNull(k.effectiveCpcBidMicros), final_url: (k.finalUrls || [])[0] || null,
      quality_score: numOrNull(qi.qualityScore), qs_creative: qi.creativeQualityScore || null,
      qs_landing_page: qi.postClickQualityScore || null, qs_expected_ctr: qi.searchPredictedCtr || null,
      first_page_cpc_micros: numOrNull(pe.firstPageCpcMicros), top_of_page_cpc_micros: numOrNull(pe.topOfPageCpcMicros),
      first_position_cpc_micros: numOrNull(pe.firstPositionCpcMicros), removed_at: null, synced_at: ts,
    }]];
  },

  shared_sets: (r) => {
    const s = r.sharedSet || {};
    return [['shared_sets', {
      customer_id: cid, shared_set_id: str(s.id), name: s.name || '', type: s.type || null, status: s.status || null,
      member_count: num(s.memberCount), removed_at: null, synced_at: ts,
    }]];
  },

  shared_criteria: (r) => {
    const s = r.sharedSet || {};
    const sc = r.sharedCriterion || {};
    return [['negatives', negativeRow('shared_list', str(s.id), sc.criterionId, null, null, str(s.id), sc.keyword)]];
  },

  campaign_shared_sets: (r) => [['campaign_shared_sets', {
    customer_id: cid, campaign_id: str((r.campaign || {}).id), shared_set_id: str((r.sharedSet || {}).id),
    status: (r.campaignSharedSet || {}).status || null, removed_at: null, synced_at: ts,
  }]],

  ads: (r) => {
    const aga = r.adGroupAd || {};
    const ad = aga.ad || {};
    const rsa = ad.responsiveSearchAd || {};
    const ps = aga.policySummary || {};
    const text = (list) => (list || []).map((h) => ({ text: h.text || '', pinned_field: h.pinnedField || null }));
    return [['ads', {
      customer_id: cid, ad_group_id: str((r.adGroup || {}).id), ad_id: str(ad.id), campaign_id: str((r.campaign || {}).id),
      type: ad.type || null, status: aga.status || null, ad_strength: aga.adStrength || null,
      final_urls: ad.finalUrls || [], path1: rsa.path1 || null, path2: rsa.path2 || null,
      headlines: text(rsa.headlines), descriptions: text(rsa.descriptions),
      approval_status: ps.approvalStatus || null, review_status: ps.reviewStatus || null,
      policy_topics: (ps.policyTopicEntries || []).map((p) => ({ topic: p.topic || null, type: p.type || null })),
      removed_at: null, synced_at: ts,
    }]];
  },

  asset_labels: (r) => {
    const v = r.adGroupAdAssetView || {};
    const [, adId] = tildeParts(v.adGroupAd);
    const m = r.metrics || {};
    return [['ad_asset_labels', {
      customer_id: cid, ad_group_id: str((r.adGroup || {}).id), ad_id: adId || '', asset_id: str((r.asset || {}).id),
      field_type: v.fieldType || 'UNKNOWN', campaign_id: str((r.campaign || {}).id),
      text: ((r.asset || {}).textAsset || {}).text || null, performance_label: v.performanceLabel || null,
      pinned_field: v.pinnedField || null, enabled: Boolean(v.enabled),
      impressions_30d: num(m.impressions), clicks_30d: num(m.clicks), cost_micros_30d: num(m.costMicros),
      conversions_30d: num(m.conversions), synced_at: ts,
    }]];
  },

  assets_account: (r) => [['assets', assetRow('account', cid, r.customerAsset, r.asset, null, null)]],
  assets_campaign: (r) => {
    const campaignId = str((r.campaign || {}).id);
    return [['assets', assetRow('campaign', campaignId, r.campaignAsset, r.asset, campaignId, null)]];
  },
  assets_ad_group: (r) => {
    const adGroupId = str((r.adGroup || {}).id);
    return [['assets', assetRow('ad_group', adGroupId, r.adGroupAsset, r.asset, str((r.campaign || {}).id), adGroupId)]];
  },

  conversion_actions: (r) => {
    const ca = r.conversionAction || {};
    const vs = ca.valueSettings || {};
    return [['conversion_actions', {
      customer_id: cid, conversion_action_id: str(ca.id), name: ca.name || '', category: ca.category || null,
      type: ca.type || null, origin: ca.origin || null, status: ca.status || null, counting_type: ca.countingType || null,
      primary_for_goal: Boolean(ca.primaryForGoal), include_in_conversions: Boolean(ca.includeInConversionsMetric),
      default_value: numOrNull(vs.defaultValue), always_use_default_value: Boolean(vs.alwaysUseDefaultValue),
      click_lookback_days: numOrNull(ca.clickThroughLookbackWindowDays),
      phone_call_duration_seconds: numOrNull(ca.phoneCallDurationSeconds),
      attribution_model: (ca.attributionModelSettings || {}).attributionModel || null, removed_at: null, synced_at: ts,
    }]];
  },

  // Reference lesson: impact (and its baseMetrics/potentialMetrics) is missing
  // for some recommendation types - default to {} and 0. status is not sent, so
  // an upsert never re-opens a row FF staff hid; "Finish account" handles open/expired.
  recommendations: (r) => {
    const rec = r.recommendation || {};
    const imp = rec.impact || {};
    const base = imp.baseMetrics || {};
    const pot = imp.potentialMetrics || {};
    return [['recommendations', {
      resource_name: rec.resourceName, customer_id: cid,
      campaign_id: rec.campaign ? lastPart(rec.campaign) : null, ad_group_id: rec.adGroup ? lastPart(rec.adGroup) : null,
      type: rec.type || 'UNKNOWN', dismissed: Boolean(rec.dismissed), impact: imp,
      est_extra_clicks: num(pot.clicks) - num(base.clicks),
      est_extra_conversions: num(pot.conversions) - num(base.conversions),
      est_cost_change_micros: num(pot.costMicros) - num(base.costMicros),
      last_seen_at: ts, synced_at: ts,
    }]];
  },

  change_events: (r) => {
    const ce = r.changeEvent || {};
    return [['change_events', {
      resource_name: ce.resourceName, customer_id: cid, changed_at: localToUtc(ce.changeDateTime) || ts,
      resource_type: ce.changeResourceType || null, changed_resource: ce.changeResourceName || null,
      operation: ce.resourceChangeOperation || null, client_type: ce.clientType || null,
      user_email: ce.userEmail || null,
      changed_fields: ce.changedFields ? String(ce.changedFields).split(',').filter(Boolean) : [],
      campaign_id: ce.campaign ? lastPart(ce.campaign) : null, ad_group_id: ce.adGroup ? lastPart(ce.adGroup) : null,
      synced_at: ts,
    }]];
  },

  campaign_daily: (r) => {
    const m = r.metrics || {};
    return [['campaign_daily', {
      customer_id: cid, campaign_id: str((r.campaign || {}).id), date: (r.segments || {}).date,
      ...metricsBasic(m),
      all_conversions: num(m.allConversions), all_conversions_value: num(m.allConversionsValue),
      view_through_conversions: num(m.viewThroughConversions),
      phone_calls: num(m.phoneCalls), phone_impressions: num(m.phoneImpressions),
      search_impression_share: numOrNull(m.searchImpressionShare),
      search_budget_lost_is: numOrNull(m.searchBudgetLostImpressionShare),
      search_rank_lost_is: numOrNull(m.searchRankLostImpressionShare),
      search_top_is: numOrNull(m.searchTopImpressionShare),
      search_abs_top_is: numOrNull(m.searchAbsoluteTopImpressionShare),
      top_impression_pct: numOrNull(m.topImpressionPercentage),
      abs_top_impression_pct: numOrNull(m.absoluteTopImpressionPercentage),
      synced_at: ts,
    }]];
  },

  ad_group_daily: (r) => {
    const m = r.metrics || {};
    return [['ad_group_daily', {
      customer_id: cid, ad_group_id: str((r.adGroup || {}).id), date: (r.segments || {}).date,
      campaign_id: str((r.campaign || {}).id), ...metricsBasic(m),
      all_conversions: num(m.allConversions), all_conversions_value: num(m.allConversionsValue),
      phone_calls: num(m.phoneCalls), synced_at: ts,
    }]];
  },

  keyword_daily: (r) => {
    const m = r.metrics || {};
    return [['keyword_daily', {
      customer_id: cid, ad_group_id: str((r.adGroup || {}).id),
      criterion_id: str((r.adGroupCriterion || {}).criterionId), date: (r.segments || {}).date,
      campaign_id: str((r.campaign || {}).id), ...metricsBasic(m), all_conversions: num(m.allConversions),
      search_impression_share: numOrNull(m.searchImpressionShare), synced_at: ts,
    }]];
  },

  search_terms: (r) => {
    const m = r.metrics || {};
    const seg = r.segments || {};
    const kw = seg.keyword || {};
    const info = kw.info || {};
    const [, keywordCriterionId] = tildeParts(kw.adGroupCriterion);
    const { stored, filtered } = filterTerm((r.searchTermView || {}).searchTerm);
    return [['search_term_daily', {
      customer_id: cid, ad_group_id: str((r.adGroup || {}).id), term_hash: sha256(stored),
      keyword_criterion_id: keywordCriterionId || '', date: seg.date, campaign_id: str((r.campaign || {}).id),
      search_term: stored, name_filtered: filtered, status: (r.searchTermView || {}).status || null,
      keyword_text: info.text || null, keyword_match_type: info.matchType || null,
      search_term_match_type: seg.searchTermMatchType || null,
      ...metricsBasic(m), all_conversions: num(m.allConversions), synced_at: ts,
    }]];
  },

  ad_daily: (r) => [['ad_daily', {
    customer_id: cid, ad_group_id: str((r.adGroup || {}).id), ad_id: str(((r.adGroupAd || {}).ad || {}).id),
    date: (r.segments || {}).date, campaign_id: str((r.campaign || {}).id), ...metricsBasic(r.metrics), synced_at: ts,
  }]],

  asset_daily: (r) => {
    const m = r.metrics || {};
    const campaignId = str((r.campaign || {}).id);
    return [['asset_daily', {
      customer_id: cid, level: 'campaign', scope_id: campaignId, asset_id: str((r.asset || {}).id),
      field_type: (r.campaignAsset || {}).fieldType || 'UNKNOWN', date: (r.segments || {}).date, campaign_id: campaignId,
      impressions: num(m.impressions), clicks: num(m.clicks), cost_micros: num(m.costMicros),
      conversions: num(m.conversions), phone_calls: 0, synced_at: ts,
    }]];
  },

  conversion_daily: (r) => {
    const m = r.metrics || {};
    const seg = r.segments || {};
    const actionId = lastPart(seg.conversionAction);
    if (!actionId) return [];
    return [['conversion_daily', {
      customer_id: cid, campaign_id: str((r.campaign || {}).id), conversion_action_id: actionId, date: seg.date,
      conversions: num(m.conversions), conversions_value: num(m.conversionsValue),
      all_conversions: num(m.allConversions), all_conversions_value: num(m.allConversionsValue), synced_at: ts,
    }]];
  },

  hourly: (r) => {
    const m = r.metrics || {};
    const seg = r.segments || {};
    return [['hourly_stats', {
      customer_id: cid, campaign_id: str((r.campaign || {}).id), date: seg.date, hour: num(seg.hour),
      day_of_week: seg.dayOfWeek || 'UNSPECIFIED', impressions: num(m.impressions), clicks: num(m.clicks),
      cost_micros: num(m.costMicros), conversions: num(m.conversions), phone_calls: num(m.phoneCalls), synced_at: ts,
    }]];
  },

  device: (r) => {
    const seg = r.segments || {};
    return [['device_daily', {
      customer_id: cid, campaign_id: str((r.campaign || {}).id), date: seg.date, device: seg.device || 'UNSPECIFIED',
      ...metricsBasic(r.metrics), synced_at: ts,
    }]];
  },

  geo: (r) => {
    const m = r.metrics || {};
    const seg = r.segments || {};
    const gv = r.geographicView || {};
    return [['geo_daily', {
      customer_id: cid, campaign_id: str((r.campaign || {}).id), date: seg.date,
      location_type: gv.locationType || 'UNSPECIFIED', geo_target_constant: seg.geoTargetMostSpecificLocation || '',
      country_criterion_id: str(gv.countryCriterionId), impressions: num(m.impressions), clicks: num(m.clicks),
      cost_micros: num(m.costMicros), conversions: num(m.conversions), synced_at: ts,
    }]];
  },

  calls: (r) => {
    const cv = r.callView || {};
    return [['calls', {
      customer_id: cid, call_resource_name: cv.resourceName, campaign_id: str((r.campaign || {}).id),
      ad_group_id: r.adGroup ? str(r.adGroup.id) : null, start_at: localToUtc(cv.startCallDateTime),
      end_at: localToUtc(cv.endCallDateTime), duration_seconds: num(cv.callDurationSeconds),
      status: cv.callStatus || null, type: cv.type || null, display_location: cv.callTrackingDisplayLocation || null,
      synced_at: ts,
    }]];
  },
};

// Natural key (matches the primary key / unique constraint) and the columns to
// sum when one batch has the same key twice.
const TABLES = {
  ad_accounts: { key: ['customer_id'] },
  campaigns: { key: ['customer_id', 'campaign_id'] },
  campaign_targets: { key: ['customer_id', 'campaign_id', 'criterion_id'] },
  ad_groups: { key: ['customer_id', 'ad_group_id'] },
  keywords: { key: ['customer_id', 'ad_group_id', 'criterion_id'] },
  negatives: { key: ['customer_id', 'level', 'scope_id', 'criterion_id'] },
  shared_sets: { key: ['customer_id', 'shared_set_id'] },
  campaign_shared_sets: { key: ['customer_id', 'campaign_id', 'shared_set_id'] },
  ads: { key: ['customer_id', 'ad_group_id', 'ad_id'] },
  ad_asset_labels: { key: ['customer_id', 'ad_group_id', 'ad_id', 'asset_id', 'field_type'] },
  assets: { key: ['customer_id', 'level', 'scope_id', 'asset_id', 'field_type'] },
  conversion_actions: { key: ['customer_id', 'conversion_action_id'] },
  recommendations: { key: ['resource_name'] },
  change_events: { key: ['resource_name'] },
  campaign_daily: { key: ['customer_id', 'campaign_id', 'date'] },
  ad_group_daily: { key: ['customer_id', 'ad_group_id', 'date'] },
  keyword_daily: { key: ['customer_id', 'ad_group_id', 'criterion_id', 'date'] },
  search_term_daily: {
    key: ['customer_id', 'ad_group_id', 'term_hash', 'keyword_criterion_id', 'date'],
    sum: ['impressions', 'clicks', 'cost_micros', 'conversions', 'conversions_value', 'all_conversions'],
  },
  ad_daily: { key: ['customer_id', 'ad_group_id', 'ad_id', 'date'] },
  asset_daily: { key: ['customer_id', 'level', 'scope_id', 'asset_id', 'field_type', 'date'] },
  conversion_daily: {
    key: ['customer_id', 'campaign_id', 'conversion_action_id', 'date'],
    sum: ['conversions', 'conversions_value', 'all_conversions', 'all_conversions_value'],
  },
  hourly_stats: { key: ['customer_id', 'campaign_id', 'date', 'hour'] },
  device_daily: { key: ['customer_id', 'campaign_id', 'date', 'device'] },
  geo_daily: {
    key: ['customer_id', 'campaign_id', 'date', 'location_type', 'geo_target_constant'],
    sum: ['impressions', 'clicks', 'cost_micros', 'conversions'],
  },
  calls: { key: ['customer_id', 'call_resource_name'] },
};

const EMPTY_KEY_OK = new Set(['keyword_criterion_id', 'geo_target_constant']);

// ---------------------------------------------------------------- run
const byTable = {}; // table -> Map(key -> row)
const queryResults = {};

inputs.forEach((item, i) => {
  const meta = $('Account: build queries').itemMatching(i).json;
  const name = meta.query_name;
  const parsed = parseStream(item.json);
  const result = { rows: 0, error: parsed.error || null, tables: [] };
  queryResults[name] = result;
  if (parsed.error) return;

  const mapper = MAP[name];
  if (!mapper) {
    result.error = `no mapper for ${name}`;
    return;
  }
  const tables = new Set();
  for (const row of parsed.rows) {
    let mapped;
    try {
      mapped = mapper(row);
    } catch (e) {
      result.error = `map error: ${e.message}`.slice(0, 300);
      continue;
    }
    for (const [table, out] of mapped) {
      const def = TABLES[table];
      // Skip a row with an incomplete key rather than fail the whole batch.
      // Two key columns legitimately hold '' (no matched keyword / no location).
      if (def.key.some((k) => out[k] === null || out[k] === undefined || (out[k] === '' && !EMPTY_KEY_OK.has(k)))) {
        continue;
      }
      tables.add(table);
      byTable[table] = byTable[table] || new Map();
      const key = def.key.map((k) => out[k]).join('|');
      const existing = byTable[table].get(key);
      if (existing && def.sum) {
        for (const col of def.sum) existing[col] = num(existing[col]) + num(out[col]);
      } else {
        byTable[table].set(key, out);
      }
      result.rows++;
    }
  }
  result.tables = [...tables];
});

const CHUNK = 500;
const out = [{
  json: {
    kind: 'start',
    table: 'sync_run_accounts',
    on_conflict: 'sync_run_id,customer_id',
    rows: [{ sync_run_id: meta0.sync_run_id, customer_id: cid, status: 'partial', started_at: ts }],
    customer_id: cid,
    pass_at: ts,
    query_results: queryResults,
  },
}];

// ad_accounts first, then structure, then facts - keeps the order readable in the log.
for (const table of Object.keys(TABLES)) {
  const rows = byTable[table] ? [...byTable[table].values()] : [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    out.push({
      json: { kind: 'upsert', table, on_conflict: TABLES[table].key.join(','), rows: rows.slice(i, i + CHUNK) },
    });
  }
}

return out;
