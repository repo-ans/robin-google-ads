// One item per account to sync. "Get accounts to sync" has alwaysOutputData on,
// so an empty table arrives as one empty item - filter it out here and emit a
// single { none: true } item instead, which "Any accounts?" routes past the loop.
const accounts = $input
  .all()
  .map((i) => i.json)
  .filter((a) => a && /^[0-9]{10}$/.test(String(a.customer_id || '')));

if (accounts.length === 0) return [{ json: { none: true } }];

return accounts.map((a) => ({
  json: {
    customer_id: String(a.customer_id),
    login_customer_id: a.login_customer_id ? String(a.login_customer_id) : null,
    time_zone: a.time_zone || 'UTC',
    first_synced_at: a.first_synced_at || null,
    towns: (a.clients && a.clients.towns) || [],
    own_brand_terms: (a.clients && a.clients.own_brand_terms) || [],
    competitor_terms: (a.clients && a.clients.competitor_terms) || [],
  },
}));
