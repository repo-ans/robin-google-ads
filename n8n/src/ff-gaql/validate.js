// @include shared/input.js
// Read-only Google Ads query for Claude Code and the FF team (PDF task 1:
// "look before changing anything"). Body: { customer_id, query, limit? }
//   query - one GAQL SELECT. No mutate path exists in this workflow: it only
//           calls googleAds:searchStream.
//   limit - rows to return, 1 to 1000 (default 200).
// Caller phone details are refused (hard rule 4); search terms are passed
// through the name filter before they are returned.
const b = requestBody();
const cid = customerId(b.customer_id);
if (!cid) return reject(400, 'customer_id must be 10 digits.');
const q = typeof b.query === 'string' ? b.query.replace(/\s+/g, ' ').trim() : '';
if (!q || q.length > 4000) return reject(400, 'query must be one GAQL SELECT of at most 4000 characters.');
if (!/^select\s/i.test(q) || q.includes(';')) return reject(400, 'Only one SELECT query is allowed.');
if (/caller_(area_code|country_code|phone)|call_view\.caller/i.test(q)) {
  return reject(400, 'Caller phone details are never read (hard rule 4).');
}
const n = b.limit === undefined ? 200 : Number(b.limit);
if (!Number.isInteger(n) || n < 1 || n > 1000) return reject(400, 'limit must be 1 to 1000.');
return [{ json: { valid: true, customer_id: cid, query: q, limit: n } }];
