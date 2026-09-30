// Runs once per account after "Write rows". Works out what succeeded, then
// emits the follow-up writes for "Account cleanup":
//   - soft-remove: structure rows Google no longer returns get removed_at set
//     (only for queries that fully succeeded - a failed query must never
//     make live keywords look removed)
//   - recommendations: open -> expired when Google stops returning them,
//     expired -> open when they come back (hidden rows are left alone)
//   - the final sync_run_accounts row, and ad_accounts.last_synced_at
//
// Each input item is the response to one "Map and plan writes" item; they are
// matched with itemMatching(i), not by position.

const inputs = $input.all();
const start = $('Map and plan writes').itemMatching(0).json;
const account = $('Loop over accounts').first().json;
const cid = start.customer_id;
const ts = start.pass_at;
const results = start.query_results || {};
const enc = encodeURIComponent;

// Tables each query writes. A write failure on a table fails its queries.
const QUERY_TABLES = {
  customer: ['ad_accounts'],
  campaigns: ['campaigns'],
  campaign_criteria: ['campaign_targets', 'negatives'],
  ad_groups: ['ad_groups'],
  keywords: ['keywords', 'negatives'],
  shared_sets: ['shared_sets'],
  shared_criteria: ['negatives'],
  campaign_shared_sets: ['campaign_shared_sets'],
  ads: ['ads'],
  asset_labels: ['ad_asset_labels'],
  assets_account: ['assets'],
  assets_campaign: ['assets'],
  assets_ad_group: ['assets'],
  conversion_actions: ['conversion_actions'],
  recommendations: ['recommendations'],
  change_events: ['change_events'],
  campaign_daily: ['campaign_daily'],
  ad_group_daily: ['ad_group_daily'],
  keyword_daily: ['keyword_daily'],
  search_terms: ['search_term_daily'],
  ad_daily: ['ad_daily'],
  asset_daily: ['asset_daily'],
  conversion_daily: ['conversion_daily'],
  hourly: ['hourly_stats'],
  device: ['device_daily'],
  geo: ['geo_daily'],
  calls: ['calls'],
};

// Structure queries and the rows they own: [table, extra PostgREST filter].
const SOFT_REMOVE = {
  campaigns: [['campaigns', '']],
  campaign_criteria: [['campaign_targets', ''], ['negatives', '&level=eq.campaign']],
  ad_groups: [['ad_groups', '']],
  keywords: [['keywords', ''], ['negatives', '&level=eq.ad_group']],
  shared_sets: [['shared_sets', '']],
  shared_criteria: [['negatives', '&level=eq.shared_list']],
  campaign_shared_sets: [['campaign_shared_sets', '']],
  ads: [['ads', '']],
  assets_account: [['assets', '&level=eq.account']],
  assets_campaign: [['assets', '&level=eq.campaign']],
  assets_ad_group: [['assets', '&level=eq.ad_group']],
  conversion_actions: [['conversion_actions', '']],
};

// 1. Write results
const failedTables = {};
let startWriteOk = true;
inputs.forEach((item, i) => {
  const plan = $('Map and plan writes').itemMatching(i).json;
  const r = item.json || {};
  const ok = r.statusCode >= 200 && r.statusCode < 300;
  if (ok) return;
  const body = r.body || {};
  const message = body.message || body.details || (r.error && r.error.message) || `status ${r.statusCode}`;
  if (plan.kind === 'start') startWriteOk = false;
  else failedTables[plan.table] = String(message).slice(0, 300);
});

// 2. Per-query outcome
const resources = {};
const failedQueries = [];
for (const [name, res] of Object.entries(results)) {
  let error = res.error || null;
  if (!error) {
    const bad = (QUERY_TABLES[name] || []).find((t) => failedTables[t]);
    if (bad) error = `write to ${bad} failed: ${failedTables[bad]}`;
  }
  resources[name] = { rows: res.rows || 0, error };
  if (error) failedQueries.push(name);
}

const total = Object.keys(results).length;
let status = 'ok';
if (failedQueries.length > 0) status = 'partial';
if (failedQueries.includes('customer') || failedQueries.length === total) status = 'failed';

const summaryError = failedQueries.length
  ? failedQueries.slice(0, 5).map((q) => `${q}: ${resources[q].error}`).join(' | ').slice(0, 1000)
  : null;

// 3. Follow-up writes
const out = [];

for (const [query, specs] of Object.entries(SOFT_REMOVE)) {
  if (!results[query] || resources[query].error) continue;
  for (const [table, extra] of specs) {
    out.push({
      json: {
        method: 'PATCH',
        path: `${table}?customer_id=eq.${cid}${extra}&removed_at=is.null&synced_at=lt.${enc(ts)}`,
        prefer: 'return=minimal',
        body: { removed_at: ts },
      },
    });
  }
}

if (results.recommendations && !resources.recommendations.error) {
  out.push({
    json: {
      method: 'PATCH',
      path: `recommendations?customer_id=eq.${cid}&status=eq.open&last_seen_at=lt.${enc(ts)}`,
      prefer: 'return=minimal',
      body: { status: 'expired' },
    },
  });
  out.push({
    json: {
      method: 'PATCH',
      path: `recommendations?customer_id=eq.${cid}&status=eq.expired&last_seen_at=gte.${enc(ts)}`,
      prefer: 'return=minimal',
      body: { status: 'open' },
    },
  });
}

const now = new Date().toISOString();
out.push({
  json: {
    method: 'POST',
    path: 'sync_run_accounts?on_conflict=sync_run_id,customer_id',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: [{
      sync_run_id: start.rows[0].sync_run_id,
      customer_id: cid,
      status,
      resources,
      error: startWriteOk ? summaryError : `could not record the start of this account's sync. ${summaryError || ''}`.trim(),
      started_at: ts,
      finished_at: now,
    }],
  },
});

if (status !== 'failed') {
  out.push({
    json: {
      method: 'PATCH',
      path: `ad_accounts?customer_id=eq.${cid}`,
      prefer: 'return=minimal',
      body: { last_synced_at: now, first_synced_at: account.first_synced_at || now },
    },
  });
}

return out;
