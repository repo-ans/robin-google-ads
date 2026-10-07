// @include shared/input.js
// @include shared/names.js
// Body, one of:
//   { source: "chat" | "message", source_id }
//       Confirm & Apply for a proposed budget / pause / resume. Only the row id
//       comes from the browser; the action itself is read from the database
//       (the reference trusted the browser's copy of proposed_action).
//   { source: "negatives", source_id: <campaigns.id>, level: "campaign" | "list",
//     match_type: "PHRASE" | "EXACT", terms: ["free cremation", ...] }
//       Add negative keywords from the Search Terms tab (PDF task 5), either to
//       the campaign or to the account's "FF - Funeral universal negatives" list.
//   { source: "tracking" | "neglist", source_id: <clients.id>, customer_id }
//       neglist: the blocked-words list on every search campaign of the account (PDF task 5).
//       Set up call tracking (90s+) for one account of the client (PDF task 2).
const b = requestBody();
if (!['chat', 'message', 'negatives', 'tracking', 'neglist'].includes(b.source)) return reject(400, 'source must be chat, message, negatives, tracking or neglist.');
if (!isUuid(b.source_id)) return reject(400, 'source_id is missing or not valid.');
if (b.source === 'tracking' || b.source === 'neglist') {
  const cid = customerId(b.customer_id);
  if (!cid) return reject(400, 'customer_id must be 10 digits.');
  return [{ json: { valid: true, source: b.source, source_id: b.source_id, customer_id: cid } }];
}
if (b.source !== 'negatives') return [{ json: { valid: true, source: b.source, source_id: b.source_id } }];

if (!['campaign', 'list'].includes(b.level)) return reject(400, 'level must be campaign or list.');
if (!['PHRASE', 'EXACT'].includes(b.match_type)) return reject(400, 'match_type must be PHRASE or EXACT. Broad negatives are not used.');
if (!Array.isArray(b.terms) || b.terms.length === 0 || b.terms.length > 50) return reject(400, 'Send 1 to 50 terms.');

// Hard rule 4: a negative keyword is written to Google Ads, write_log and the
// negatives table, so a term that looks like a person's name is refused.
const { filterTerm } = makeNameFilters([]);
const terms = [];
for (const raw of b.terms) {
  const t = String(raw === undefined || raw === null ? '' : raw).toLowerCase().replace(/\s+/g, ' ').trim();
  // "[name removed - ...]" placeholders, and anything that is not plain words, are refused.
  if (!t || t.length > 80 || !/^[a-z0-9][a-z0-9 '&.-]*$/.test(t)) return reject(400, `"${String(raw).slice(0, 40)}" is not a plain search term.`);
  if (filterTerm(t).filtered) return reject(400, `"${t.slice(0, 40)}" looks like it holds a person's name, so it cannot be used as a negative keyword.`);
  if (t.split(' ').length > 10) return reject(400, 'A negative keyword can have at most 10 words.');
  if (!terms.includes(t)) terms.push(t);
}
return [{ json: { valid: true, source: 'negatives', source_id: b.source_id, level: b.level, match_type: b.match_type, terms } }];
