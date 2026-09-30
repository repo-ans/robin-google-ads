// @include shared/ai.js
// Campaigns worth a proactive look (ff_suggestion_candidates already applied the
// reference dedupe: no unresolved proposal, nothing proactive in the last 24h).
// One item per campaign for the AI Agent; { skip: true } when there are none.
const cfg = $('Config').first().json;
const rows = $input.all().map((i) => i.json).filter((r) => r && r.campaign_id);

if (!cfg.AI_SUGGESTIONS || rows.length === 0) return [{ json: { skip: true } }];

return rows.slice(0, 50).map((r) => ({
  json: {
    skip: false,
    customer_id: r.customer_id,
    campaign_id: r.campaign_id,
    campaign_name: r.campaign_name,
    status: r.status,
    currency: r.currency_code || '',
    daily_budget: money(r.budget_micros),
    last_day: r.last_day,
    day_cost: money(r.day_cost_micros),
    day_clicks: Number(r.day_clicks || 0),
    day_conversions: Number(r.day_conversions || 0),
    cost_30d: money(r.cost_30d_micros),
    clicks_30d: Number(r.clicks_30d || 0),
    conversions_30d: Math.round(Number(r.conversions_30d || 0) * 100) / 100,
    conv_value_30d: Math.round(Number(r.conv_value_30d || 0) * 100) / 100,
    search_is_30d: pct(r.search_is_30d),
    budget_lost_is_30d: pct(r.budget_lost_is_30d),
    recommendations: r.recommendations || 'None open.',
  },
}));
