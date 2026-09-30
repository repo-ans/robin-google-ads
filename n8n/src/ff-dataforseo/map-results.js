// DataForSEO + Google Keyword Planner responses -> keyword_volume rows
// (source 'dataforseo' / 'google_kp'), cached per month. Related keywords are
// stored on the seed's DataForSEO row. Rows in one request share the same keys.
const t = $('Build requests').first().json;
const dfs = $('DataForSEO search volume').first().json || {};
const kp = $('Google keyword metrics').first().json || {};
const relatedInputs = $input.all();

const now = new Date();
const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
const syncedAt = now.toISOString();
const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
const intOrNull = (v) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v)));
const microsFromMoney = (v) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 1e6));
const ok = (r) => r && r.statusCode >= 200 && r.statusCode < 300;

const rows = new Map();
function put(row) {
  const key = [row.source, row.keyword_norm, row.geo_target, row.language, row.fetched_month].join('|');
  const prev = rows.get(key);
  rows.set(key, prev ? { ...prev, ...row, related_keywords: row.related_keywords.length ? row.related_keywords : prev.related_keywords } : row);
}
const base = (source, keyword, geo) => ({
  source, keyword_norm: norm(keyword), geo_target: geo, language: t.language_code, fetched_month: month,
  avg_monthly_searches: null, competition: null, competition_index: null, low_top_bid_micros: null,
  high_top_bid_micros: null, avg_cpc_micros: null, monthly_searches: [], related_keywords: [], synced_at: syncedAt,
});

const errors = [];

// DataForSEO search volume
const dfsTask = ok(dfs) && dfs.body && dfs.body.tasks && dfs.body.tasks[0];
if (dfsTask && dfsTask.status_code === 20000) {
  for (const r of dfsTask.result || []) {
    if (!r || !r.keyword) continue;
    put({
      ...base('dataforseo', r.keyword, String(t.location_code)),
      avg_monthly_searches: intOrNull(r.search_volume),
      competition: r.competition || null,
      competition_index: intOrNull(r.competition_index),
      low_top_bid_micros: microsFromMoney(r.low_top_of_page_bid),
      high_top_bid_micros: microsFromMoney(r.high_top_of_page_bid),
      avg_cpc_micros: microsFromMoney(r.cpc),
      monthly_searches: (r.monthly_searches || []).map((x) => ({ year: x.year, month: x.month, searches: x.search_volume })),
    });
  }
} else {
  errors.push(`DataForSEO search volume: ${(dfsTask && dfsTask.status_message) || (dfs.body && dfs.body.status_message) || `status ${dfs.statusCode}`}`);
}

// Google Keyword Planner historical metrics
if (ok(kp)) {
  for (const r of (kp.body && kp.body.results) || []) {
    const km = r.keywordMetrics || {};
    if (!r.text) continue;
    put({
      ...base('google_kp', r.text, ''),
      avg_monthly_searches: intOrNull(km.avgMonthlySearches),
      competition: km.competition || null,
      competition_index: intOrNull(km.competitionIndex),
      low_top_bid_micros: intOrNull(km.lowTopOfPageBidMicros),
      high_top_bid_micros: intOrNull(km.highTopOfPageBidMicros),
      avg_cpc_micros: intOrNull(km.averageCpcMicros),
      monthly_searches: (km.monthlySearchVolumes || []).map((x) => ({ year: x.year, month: x.month, searches: intOrNull(x.monthlySearches) })),
    });
  }
} else {
  errors.push(`Google Keyword Planner: status ${kp.statusCode}`);
}

// Related keywords (one response per seed)
relatedInputs.forEach((item, i) => {
  let seedItem;
  try {
    seedItem = $('Related seeds').itemMatching(i).json;
  } catch (e) {
    seedItem = ($('Related seeds').all()[i] || {}).json || {};
  }
  if (!seedItem || seedItem.skip) return;
  const r = item.json || {};
  const task = ok(r) && r.body && r.body.tasks && r.body.tasks[0];
  const result = task && task.result && task.result[0];
  if (!result) {
    errors.push(`Related keywords for one seed: ${(task && task.status_message) || `status ${r.statusCode}`}`);
    return;
  }
  const related = (result.items || []).slice(0, 50).map((x) => {
    const kd = x.keyword_data || {};
    const info = kd.keyword_info || {};
    return { keyword: kd.keyword, volume: intOrNull(info.search_volume), cpc: info.cpc ?? null, competition: info.competition_level || null };
  }).filter((x) => x.keyword);
  const key = ['dataforseo', norm(seedItem.seed), String(t.location_code), t.language_code, month].join('|');
  const existing = rows.get(key) || base('dataforseo', seedItem.seed, String(t.location_code));
  rows.set(key, { ...existing, related_keywords: related });
});

const all = [...rows.values()];
const out = [];
for (let i = 0; i < all.length; i += 500) out.push({ json: { rows: all.slice(i, i + 500), errors } });
if (!out.length) out.push({ json: { rows: [], errors } });
return out;
