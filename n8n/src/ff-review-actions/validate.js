// @include shared/input.js
// Body:
//   { action: "triage", customer_id, campaign_id, term_hash, decision: keep | block | ask_rob, theme?, note? }
//   { action: "hide_recommendation" | "unhide_recommendation", resource_name }
// "block" records the decision only. Adding the negative in Google Ads is a
// write, done by Rob from the Negatives tab (not in this workflow).
const b = requestBody();

if (b.action === 'triage') {
  const cid = customerId(b.customer_id);
  if (!cid) return reject(400, 'customer_id must be 10 digits.');
  if (!/^[0-9]{1,20}$/.test(String(b.campaign_id || ''))) return reject(400, 'campaign_id is not valid.');
  if (!/^[0-9a-f]{64}$/.test(String(b.term_hash || ''))) return reject(400, 'term_hash is not valid.');
  if (!['keep', 'block', 'ask_rob'].includes(b.decision)) return reject(400, 'decision must be keep, block or ask_rob.');
  return [{
    json: {
      valid: true, action: 'triage', customer_id: cid, campaign_id: String(b.campaign_id), term_hash: b.term_hash,
      decision: b.decision, theme: text(b.theme, 60) || null, note: text(b.note, 300) || null,
    },
  }];
}

if (b.action === 'hide_recommendation' || b.action === 'unhide_recommendation') {
  if (!/^customers\/[0-9]{10}\/recommendations\/[A-Za-z0-9~_-]+$/.test(String(b.resource_name || ''))) {
    return reject(400, 'resource_name is not valid.');
  }
  return [{ json: { valid: true, action: b.action, resource_name: b.resource_name } }];
}

return reject(400, 'action must be triage, hide_recommendation or unhide_recommendation.');
