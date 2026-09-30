// ff_chat_context -> plain-text blocks for the prompt (reference "Build AI
// context", now with 30-day, 7-day, calls, search terms and keyword health).
// Everything here is numbers, campaign names, recommendation types and
// name-filtered search terms - no personal data.
const ctx = $input.first().json || {};
const msg = $('Route').first().json;
const c = ctx.campaign || {};
const cur = c.currency || '';
const p = ctx.last_30_days || {};
const calls = ctx.calls_30d || {};
const kw = ctx.keywords || {};
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(Number(v) * 100)}%`);

const campaignText = `${c.name || 'Campaign'} - status ${c.status || 'unknown'}, bidding ${c.bidding || 'unknown'}, ` +
  `daily budget ${c.daily_budget} ${cur}${c.budget_shared ? ' (shared budget)' : ''}, location setting ${c.geo_target_type || 'unknown'}.`;

const perfText = `Last 30 days: cost ${p.cost ?? 0} ${cur}, ${p.clicks ?? 0} clicks, ${p.impressions ?? 0} impressions, ` +
  `${p.conversions ?? 0} conversions (value ${p.conversion_value ?? 0} ${cur}), ${p.phone_calls ?? 0} calls from ads, ` +
  `search impression share ${pct(p.avg_search_impression_share)}, lost to budget ${pct(p.avg_budget_lost_is)}. ` +
  `Calls recorded: ${calls.total ?? 0}, of which ${calls.over_90s ?? 0} lasted 90 seconds or more.`;

const last7 = (ctx.last_7_days || []).map((d) => `${d.date}: cost ${d.cost} ${cur}, ${d.clicks} clicks, ${d.conversions} conv`);
const recs = (ctx.recommendations || []).map((r) => `- ${r.type}${r.est_extra_conversions ? ` (est. +${r.est_extra_conversions} conversions)` : ''}`);
const terms = (ctx.top_search_terms_30d || []).map((t) => `- "${t.term}": cost ${t.cost} ${cur}, ${t.clicks} clicks, ${t.conversions} conv`);
const history = (ctx.history || [])
  .filter((h) => h.content)
  .map((h) => `${h.role === 'user' ? 'FF staff' : 'Assistant'}: ${h.content}`);

return [{
  json: {
    campaignText,
    perfText,
    last7Text: last7.length ? last7.join('\n') : 'No daily data yet.',
    recommendationsText: recs.length ? recs.join('\n') : 'None open.',
    searchTermsText: terms.length ? terms.join('\n') : 'No search terms yet.',
    keywordsText: `${kw.count ?? 0} active keywords, average Quality Score ${kw.avg_quality_score ?? 'n/a'}, ${kw.low_quality ?? 0} below 5.`,
    historyText: history.length ? history.slice(-20).join('\n') : '(no earlier messages)',
    userMessage: msg.content,
    currency: cur,
  },
}];
