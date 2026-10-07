// Links clients that have no GHL sub-account yet to FF's GHL sub-accounts, by
// themselves: same business name, same website, or same business phone. Only an
// unambiguous match is saved (one sub-account for one client, not used by
// another client). Output: Supabase PATCH items for "Save GHL links", or one
// no-op item. Business names, websites and phones only - no family data.
const res = $('GHL: list sub-accounts').first().json || {};
const clients = $('Clients without GHL').all().map((i) => i.json).filter((c) => c && c.client_id);
const linked = new Set($('Linked GHL sub-accounts').all().map((i) => i.json && i.json.ghl_location_id).filter(Boolean));
const NOOP = [{ json: { method: 'GET', path: 'clients?select=id&limit=0', body: null, matched: 0 } }];

if (!(res.statusCode >= 200 && res.statusCode < 300) || !clients.length) return NOOP;
const locations = ((res.body && res.body.locations) || []).filter((l) => l && l.id && !linked.has(l.id));

const STOP = new Set(['the', 'inc', 'ltd', 'llc', 'co', 'and', 'of', 'corp', 'company']);
const name = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter((w) => w && !STOP.has(w)).join(' ');
const host = (s) => {
  const m = /^(?:https?:\/\/)?(?:www\.)?([^/?#:]+)/i.exec(String(s || '').trim());
  return m ? m[1].toLowerCase() : '';
};
const phone = (s) => String(s || '').replace(/\D/g, '').slice(-10);

const out = [];
const used = new Set();
for (const c of clients) {
  const hits = locations.filter((l) => !used.has(l.id) && (
    (name(c.name) && name(l.name) === name(c.name))
    || (host(c.website_url) && host(l.website) === host(c.website_url))
    || (phone(c.phone).length === 10 && phone(l.phone) === phone(c.phone))
  ));
  if (hits.length !== 1) continue;
  used.add(hits[0].id);
  out.push({ json: {
    method: 'PATCH',
    path: `clients?id=eq.${c.client_id}&ghl_location_id=is.null`,
    prefer: 'return=minimal',
    body: { ghl_location_id: String(hits[0].id) },
    matched: 1,
  } });
}
return out.length ? out : NOOP;
