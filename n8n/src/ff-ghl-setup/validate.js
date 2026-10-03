// @include shared/input.js
// Body:
//   { action: "list_locations" }              FF's GHL sub-accounts, to pick one on Edit client
//   { action: "check" | "setup", client_id }
//     check - can the FF GHL agency key open this client's sub-account, and are
//             the Google Ads click fields and tag there?
//     setup - the same, then creates whatever is missing (fields and tag only).
const b = requestBody();
if (b.action === 'list_locations') return [{ json: { valid: true, action: 'list_locations' } }];
if (!['check', 'setup'].includes(b.action)) return reject(400, 'action must be list_locations, check or setup.');
if (!isUuid(b.client_id)) return reject(400, 'client_id is missing or not valid.');
return [{ json: { valid: true, action: b.action, client_id: b.client_id } }];
