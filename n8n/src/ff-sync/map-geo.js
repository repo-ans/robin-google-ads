// @include shared/gads.js
// geo_target_constant search response -> geo_targets rows (a name lookup cache).
const parsed = parseStream($input.first().json || {});
const now = new Date().toISOString();
const rows = [];
for (const row of parsed.rows || []) {
  const g = row.geoTargetConstant || {};
  if (!g.resourceName) continue;
  rows.push({
    geo_target_constant: g.resourceName,
    name: g.name || null,
    canonical_name: g.canonicalName || null,
    target_type: g.targetType || null,
    country_code: g.countryCode || null,
    synced_at: now,
  });
}
return [{ json: { rows, error: parsed.error || null } }];
