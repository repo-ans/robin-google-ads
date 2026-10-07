// Turns the won opportunities' contacts into case rows - the same shape as a
// CSV row - kept only in this execution (no execution data is saved), then sent
// to Google by "Plan uploads". From each contact: phone, email, and the click id
// (the gclid / gbraid / wbraid contact fields the website script fills, or GHL's
// own attribution). Each contact answer is matched to its opportunity with
// itemMatching(i), never by position. Output: { cases, from: 'ghl', note }.
const won = $('GHL: won in month').all().map((i) => i.json);
const fieldsRes = $('GHL: contact fields').first().json || {};

if (won.length === 1 && won[0].none) {
  return [{ json: { cases: [], from: 'ghl', error: won[0].error || null, note: won[0].error ? null : 'No won opportunities in GHL for this month.' } }];
}

const keyById = new Map(((fieldsRes.body && fieldsRes.body.customFields) || [])
  .map((f) => [f.id, String(f.fieldKey || f.name || '').replace(/^contact\./, '').toLowerCase()]));

let contacts = [];
try {
  contacts = $('GHL: get contacts').all();
} catch (e) {
  contacts = [];
}
const cases = [];
contacts.forEach((item, i) => {
  const opp = $('GHL: won in month').itemMatching(i).json;
  const r = item.json || {};
  if (!(r.statusCode >= 200 && r.statusCode < 300)) return;
  const c = (r.body && r.body.contact) || {};
  const custom = {};
  for (const f of c.customFields || c.customField || []) {
    const key = keyById.get(f.id);
    if (key && f.value) custom[key] = String(f.value);
  }
  const attr = c.attributionSource || c.lastAttributionSource || {};
  const row = { case_date: opp.won_at, case_type: 'ghl won' };
  if (opp.value) row.value = String(opp.value);
  if (c.phone) row.phone = String(c.phone);
  if (c.email) row.email = String(c.email);
  const gclid = custom.gclid || attr.gclid;
  if (gclid) row.gclid = String(gclid);
  if (custom.gbraid || attr.gbraid) row.gbraid = String(custom.gbraid || attr.gbraid);
  if (custom.wbraid || attr.wbraid) row.wbraid = String(custom.wbraid || attr.wbraid);
  cases.push(row);
});

return [{ json: { cases, from: 'ghl', error: null, note: `${cases.length} won opportunit${cases.length === 1 ? 'y' : 'ies'} read from GHL.` } }];
