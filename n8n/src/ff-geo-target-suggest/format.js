// @include shared/gads.js
// @include shared/input.js
// geoTargetConstants:suggest -> up to 10 distinct suggestions (reference
// "Format suggestions"). canonical_name is fully qualified, e.g.
// "Mount Pleasant,South Carolina,United States", so builds resolve it exactly.
const r = $input.first().json || {};
const error = gadsError(r);
if (error) return reply(502, { error: `Google Ads could not suggest locations: ${error}` });

const body = gadsBody(r) || {};
const seen = new Set();
const suggestions = [];
for (const s of body.geoTargetConstantSuggestions || []) {
  const g = s.geoTargetConstant;
  if (!g || !g.resourceName || seen.has(g.resourceName)) continue;
  seen.add(g.resourceName);
  suggestions.push({
    resource_name: g.resourceName,
    name: g.name || '',
    canonical_name: g.canonicalName || g.name || '',
    country_code: g.countryCode || null,
    target_type: g.targetType || null,
    reach: s.reach ? Number(s.reach) : null,
  });
  if (suggestions.length >= 10) break;
}
return reply(200, { suggestions });
