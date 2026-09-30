// Geo target constants that have no name yet (from ff_missing_geo_targets).
// Emits exactly one item: { skip: true } when there is nothing to look up.
const cfg = $('Config').first().json;
const ids = $input
  .all()
  .map((i) => i.json && i.json.geo_target_constant)
  .filter((g) => typeof g === 'string' && /^geoTargetConstants\/[0-9]+$/.test(g));

// geo_target_constant can be queried through any account; prefer the MCC.
let customerId = cfg.MCC_ID || null;
let loginCustomerId = cfg.MCC_ID || null;
if (!customerId) {
  const first = $('Prepare account list').first().json;
  customerId = first.customer_id || null;
  loginCustomerId = first.login_customer_id || null;
}

if (ids.length === 0 || !customerId) return [{ json: { skip: true, count: 0 } }];

const list = ids.map((g) => `'${g}'`).join(',');
return [{
  json: {
    skip: false,
    count: ids.length,
    customer_id: customerId,
    login_customer_id: loginCustomerId,
    gaql: `SELECT geo_target_constant.resource_name, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.target_type, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.resource_name IN (${list})`,
  },
}];
