// Case list straight from GHL (no CSV): the client's sub-account opportunities
// with status "won" whose status changed in the chosen month. In GHL "won" is
// the status a funeral home sets when a family signs, whatever its stage names.
// Output: one item per won opportunity { contact_id, won_at, value }, or one
// { none: true, error? } item. Names are never read on: only ids, dates, values.
const v = $('Validate input').first().json;
const tokenRes = $('GHL: location token').first().json || {};
const res = $input.first().json || {};

const fail = (error) => [{ json: { none: true, error } }];
if (!($('Get client GHL').first().json || {}).ghl_location_id) {
  return fail('This client has no GHL sub-account yet. Pick it on Edit client (Pick from GHL).');
}
if (!(tokenRes.statusCode >= 200 && tokenRes.statusCode < 300 && tokenRes.body && tokenRes.body.access_token)) {
  const said = String((tokenRes.body && tokenRes.body.message) || '');
  if (/scope/i.test(said)) {
    return fail('The FF GHL app is missing scopes or is not installed on this sub-account. In the GHL Marketplace app add oauth.readonly, oauth.write, opportunities.readonly and contacts.readonly, install it on the sub-account, then press Connect again on the n8n credential "FF GHL OAuth".');
  }
  const ghlSaid = ` (GHL said: ${tokenRes.statusCode || 'no answer'}${said ? ` - ${said.slice(0, 160)}` : ''})`;
  return fail('GHL could not open this client\'s sub-account' + ghlSaid + '. Check that the FF GHL app (n8n credential "FF GHL OAuth") is connected and installed on it, GHL_COMPANY_ID in n8n, and the GHL sub-account on Edit client.');
}
if (!(res.statusCode >= 200 && res.statusCode < 300)) {
  return fail(res.statusCode === 403
    ? 'The FF GHL app needs the opportunities.readonly and contacts.readonly scopes.'
    : `GHL answered with status ${res.statusCode || 'none'} for the opportunities. Try again in a minute.`);
}

const opps = (res.body && res.body.opportunities) || [];
const out = [];
for (const o of opps) {
  if (String(o.status || '').toLowerCase() !== 'won') continue;
  const when = String(o.lastStatusChangeAt || o.updatedAt || o.dateUpdated || o.createdAt || '');
  if (when.slice(0, 7) !== v.month) continue;
  const contactId = o.contactId || (o.contact && o.contact.id);
  if (!contactId) continue;
  out.push({ json: { contact_id: String(contactId), won_at: when.slice(0, 10), value: Number(o.monetaryValue) > 0 ? Number(o.monetaryValue) : null } });
}
const total = Number(res.body && res.body.meta && res.body.meta.total) || opps.length;
if (!out.length) return [{ json: { none: true, error: null, checked: opps.length, total } }];
return out;
