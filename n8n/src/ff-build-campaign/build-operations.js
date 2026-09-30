// @include shared/gads.js
// One atomic GoogleAdsService.Mutate request for the whole campaign, using
// temporary (negative) resource ids so later operations can refer to earlier
// ones. Either everything is created or nothing is. Everything is PAUSED.
// Replaces the reference's 12 chained create calls, which could fail half-way
// and leave a partial campaign behind.
const cfg = $('Config').first().json;
const plan = $('Plan build').first().json;
const found = parseStream($input.first().json || {});
const { clean, ctx } = plan;
const client = ctx.client || {};
const C = `customers/${plan.customer_id}`;

let tempId = -1;
const temp = (kind) => `${C}/${kind}/${tempId--}`;
const ops = [];

// Budget and campaign
const budget = temp('campaignBudgets');
ops.push({ campaignBudgetOperation: { create: {
  resourceName: budget, name: `${clean.name} - budget ${Date.now()}`, amountMicros: String(clean.daily_budget_micros),
  deliveryMethod: 'STANDARD', explicitlyShared: false,
} } });

const bidding = {
  MAXIMIZE_CONVERSIONS: { maximizeConversions: {} },
  MAXIMIZE_CLICKS: { targetSpend: {} },
  MANUAL_CPC: { manualCpc: { enhancedCpcEnabled: false } },
}[clean.bidding_strategy];

const campaign = temp('campaigns');
ops.push({ campaignOperation: { create: {
  resourceName: campaign, name: clean.name, campaignBudget: budget, status: 'PAUSED',
  advertisingChannelType: 'SEARCH',
  networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
  // SOP: people in the area only, not people searching about it from elsewhere.
  geoTargetTypeSetting: { positiveGeoTargetType: 'PRESENCE', negativeGeoTargetType: 'PRESENCE' },
  containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
  ...bidding,
} } });

// Locations, language, schedule
for (const g of clean.geo_targets) {
  ops.push({ campaignCriterionOperation: { create: { campaign, location: { geoTargetConstant: g.resource_name } } } });
}
const LANGUAGES = { en: 'languageConstants/1000', fr: 'languageConstants/1002', es: 'languageConstants/1003' };
ops.push({ campaignCriterionOperation: { create: {
  campaign, language: { languageConstant: LANGUAGES[(ctx.client && ctx.client.language_code) || 'en'] || LANGUAGES.en },
} } });
if (clean.template === 'C') {
  // Preplanning runs in office hours. A (at-need) has no schedule = 24/7.
  const oh = client.office_hours || {};
  for (const day of oh.days || ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']) {
    ops.push({ campaignCriterionOperation: { create: { campaign, adSchedule: {
      dayOfWeek: day, startHour: Number(oh.start_hour ?? 9), startMinute: 'ZERO',
      endHour: Number(oh.end_hour ?? 17), endMinute: 'ZERO',
    } } } });
  }
}

// Competitor and other client names: campaign-level phrase negatives (from config).
for (const term of client.competitor_terms || []) {
  const t = String(term).toLowerCase().trim();
  if (t) ops.push({ campaignCriterionOperation: { create: { campaign, negative: true, keyword: { text: t, matchType: 'PHRASE' } } } });
}

// FF universal negative list: reuse the account's list if it exists, otherwise create it.
let sharedSet = found.rows && found.rows[0] && found.rows[0].sharedSet && found.rows[0].sharedSet.resourceName;
const reusedList = Boolean(sharedSet);
if (!sharedSet) {
  sharedSet = temp('sharedSets');
  ops.push({ sharedSetOperation: { create: { resourceName: sharedSet, name: cfg.NEGATIVE_LIST_NAME, type: 'NEGATIVE_KEYWORDS' } } });
  for (const n of cfg.NEGATIVE_LIST) {
    ops.push({ sharedCriterionOperation: { create: { sharedSet, keyword: { text: n.text, matchType: n.match_type } } } });
  }
}
ops.push({ campaignSharedSetOperation: { create: { campaign, sharedSet } } });

// Ad groups, keywords, ads
for (const g of clean.ad_groups) {
  const adGroup = temp('adGroups');
  ops.push({ adGroupOperation: { create: {
    resourceName: adGroup, name: g.name, campaign, status: 'PAUSED', type: 'SEARCH_STANDARD',
  } } });
  for (const k of g.keywords) {
    ops.push({ adGroupCriterionOperation: { create: {
      adGroup, status: 'ENABLED', keyword: { text: k.text, matchType: k.match_type },
    } } });
  }
  for (const a of g.ads) {
    const rsa = {
      headlines: a.headlines.map((text) => ({ text })),
      descriptions: a.descriptions.map((text) => ({ text })),
    };
    if (a.path1) rsa.path1 = a.path1;
    if (a.path2) rsa.path2 = a.path2;
    ops.push({ adGroupAdOperation: { create: {
      adGroup, status: 'PAUSED', ad: { finalUrls: [g.final_url], responsiveSearchAd: rsa },
    } } });
  }
}

return [{ json: { body: { mutateOperations: ops }, op_count: ops.length, reused_negative_list: reusedList } }];
