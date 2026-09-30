// @include shared/input.js
// Body:
//   { action: "generate", client_id, customer_id }   FF staff or Rob
//   { action: "review", audit_id }                   rob_admin only - marks it read and approved
const b = requestBody();
const user = caller();

if (b.action === 'generate') {
  if (!isUuid(b.client_id)) return reject(400, 'client_id is missing or not valid.');
  const cid = customerId(b.customer_id);
  if (!cid) return reject(400, 'customer_id must be 10 digits.');
  return [{ json: { valid: true, action: 'generate', client_id: b.client_id, customer_id: cid } }];
}
if (b.action === 'review') {
  if (user.role !== 'rob_admin') return reject(403, 'Only Rob marks an audit as reviewed.');
  if (!isUuid(b.audit_id)) return reject(400, 'audit_id is missing or not valid.');
  return [{ json: { valid: true, action: 'review', audit_id: b.audit_id } }];
}
return reject(400, 'action must be generate or review.');
