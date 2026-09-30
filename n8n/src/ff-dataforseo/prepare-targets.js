// One item per client with keywords to research (ff_keyword_research_targets:
// our positive keywords, negatives and non-name search terms, most spend first).
// { none: true } when there is nothing, so the loop is skipped cleanly.
const rows = $input.all().map((i) => i.json).filter((r) => r && r.client_id && Array.isArray(r.keywords) && r.keywords.length);
if (!rows.length) return [{ json: { none: true } }];
return rows.map((r) => ({
  json: {
    client_id: r.client_id,
    customer_id: r.customer_id,
    login_customer_id: r.login_customer_id || null,
    location_code: Number(r.location_code) || 2840,
    language_code: r.language_code || 'en',
    keywords: r.keywords.slice(0, 1000),
    seeds: (r.seeds || []).filter(Boolean),
    geo_targets: (r.geo_targets || []).filter(Boolean).slice(0, 10),
  },
}));
