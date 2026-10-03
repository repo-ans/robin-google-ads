// @include shared/input.js
// Compares the location's contact custom fields and tags with what the
// preplanning form needs (PDF task 3), from "GHL: get custom fields" and
// "GHL: get tags". Returns { kind: "done", status, body } for the Respond node,
// or one { kind: "create", url, body } item per missing field or tag.
const v = $('Validate input').first().json;
const client = $('Get client').first().json || {};
const cfg = $('Config').first().json;
const tokenRes = $('GHL: location token').first().json || {};
const fieldsRes = $('GHL: get custom fields').first().json || {};
const tagsRes = $input.first().json || {};

const FIELDS = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const TAG = String(cfg.GHL_GOOGLE_ADS_TAG || 'from google ads').toLowerCase();

const problem = (res) => {
  const s = res.statusCode;
  if (s >= 200 && s < 300) return null;
  if (s === 401) return 'GHL refused the sub-account token. Run Check GHL again.';
  if (s === 403) return 'The FF GHL agency key needs the custom fields and tags scopes.';
  if (s === 404 || s === 400) return 'GHL does not know this location ID. Check it on Edit client.';
  return `GHL answered with status ${s || 'none'}. Try again in a minute.`;
};
const tokenProblem = (res) => {
  const s = res.statusCode;
  if (s >= 200 && s < 300 && res.body && res.body.access_token) return null;
  if (s === 401) return 'GHL refused the FF GHL key. It must be the agency-level key, in the n8n credential "FF GHL".';
  if (s === 403) return 'The FF GHL agency key cannot open sub-accounts. Give it the oauth scopes (oauth.readonly, oauth.write).';
  if (s === 400 || s === 404 || s === 422) return 'GHL could not open this sub-account. Check GHL_COMPANY_ID in Config and the client\'s GHL sub-account.';
  return `GHL answered with status ${s || 'none'} when opening the sub-account. Try again in a minute.`;
};
const err = tokenProblem(tokenRes) || problem(fieldsRes) || problem(tagsRes);
if (err) return [{ json: { kind: 'done', status: 502, body: { ok: false, message: err } } }];

const have = new Set(
  ((fieldsRes.body && fieldsRes.body.customFields) || [])
    .flatMap((f) => [String(f.fieldKey || '').replace(/^contact\./, '').toLowerCase(), String(f.name || '').toLowerCase()]),
);
const missingFields = FIELDS.filter((f) => !have.has(f));
const tagThere = ((tagsRes.body && tagsRes.body.tags) || []).some((t) => String(t.name || '').toLowerCase() === TAG);

if (v.action === 'check' || (!missingFields.length && tagThere)) {
  const ready = !missingFields.length && tagThere;
  const parts = [];
  if (missingFields.length) parts.push(`missing fields: ${missingFields.join(', ')}`);
  if (!tagThere) parts.push(`missing tag: ${TAG}`);
  return [{
    json: {
      kind: 'done', status: 200,
      body: {
        ok: ready, missing_fields: missingFields, tag_present: tagThere,
        message: ready
          ? `GHL is ready for ${client.name || 'this client'}: the key works, all ${FIELDS.length} click fields and the "${TAG}" tag are there.`
          : `GHL key works. ${parts.join('; ')}. Use "Set up GHL fields" to add them.`,
      },
    },
  }];
}

const base = `https://services.leadconnectorhq.com/locations/${encodeURIComponent(client.ghl_location_id)}`;
const creates = missingFields.map((name) => ({ url: `${base}/customFields`, body: { name, dataType: 'TEXT', model: 'contact' }, what: `field ${name}` }));
if (!tagThere) creates.push({ url: `${base}/tags`, body: { name: TAG }, what: `tag ${TAG}` });
return creates.map((c) => ({ json: { kind: 'create', ...c } }));
