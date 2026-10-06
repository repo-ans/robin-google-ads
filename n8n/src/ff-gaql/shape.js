// @include shared/gads.js
// @include shared/names.js
// searchStream answer -> { rows, total, truncated } for the caller. Every
// search term in the answer goes through the name filter first (hard rule 4),
// using the client's towns, brand and competitor names as allowed words.
const v = $('Validate input').first().json;
const acct = $('Get account').first().json || {};
const client = acct.clients || {};
const { filterTerm } = makeNameFilters([
  ...(client.towns || []), ...(client.own_brand_terms || []), ...(client.competitor_terms || []),
]);

const parsed = parseStream($input.first().json || {});
if (parsed.error) return [{ json: { status: 502, body: { error: `Google Ads: ${parsed.error}` } } }];

let filtered = 0;
function clean(value, key) {
  if (Array.isArray(value)) return value.map((x) => clean(x, key));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(value)) out[k] = clean(x, k);
    return out;
  }
  if ((key === 'searchTerm' || key === 'search_term') && typeof value === 'string') {
    const f = filterTerm(value);
    if (f.filtered) filtered++;
    return f.stored;
  }
  return value;
}

const rows = parsed.rows.slice(0, v.limit).map((r) => clean(r));
return [{
  json: {
    status: 200,
    body: {
      customer_id: v.customer_id,
      account: acct.descriptive_name || null,
      total: parsed.rows.length,
      returned: rows.length,
      truncated: parsed.rows.length > rows.length,
      search_terms_name_filtered: filtered,
      rows,
    },
  },
}];
