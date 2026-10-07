// @include shared/input.js
// Monthly case match (PDF task 6). Body:
//   { action: "check" | "upload", client_id, customer_id, month: "2026-09",
//     again?: true, cases: [ { case_date, case_type?, value?, gclid?, gbraid?, wbraid?,
//                              email?, phone?, call_time? }, ... ] }
//   or { action, client_id, customer_id, month, again?, source: "ghl" } - no list: n8n reads
//      the month's won opportunities from the client's GHL sub-account itself.
//   check  - FF staff or Rob: Google Ads checks every case (validateOnly), nothing is sent
//   upload - Rob only: check first, then upload
// The list holds no names - only the columns above are accepted, and any other
// column refuses the whole request. It is never written anywhere: this workflow
// keeps no execution data, and only counts are saved (case_match_runs).
const b = requestBody();
const user = caller();

if (!['check', 'upload'].includes(b.action)) return reject(400, 'action must be check or upload.');
if (b.action === 'upload' && user.role !== 'rob_admin') return reject(403, 'Only Rob uploads signed cases to Google Ads. FF staff can run the check.');
if (!isUuid(b.client_id)) return reject(400, 'client_id is missing or not valid.');
const cid = customerId(b.customer_id);
if (!cid) return reject(400, 'customer_id must be 10 digits.');
if (typeof b.month !== 'string' || !/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(b.month)) return reject(400, 'month must look like 2026-09.');
const fromGhl = b.source === 'ghl';
if (fromGhl && b.cases !== undefined) return reject(400, 'Send either a case list or source "ghl", not both.');
if (!fromGhl && (!Array.isArray(b.cases) || b.cases.length === 0)) return reject(400, 'The case list is empty.');
if (!fromGhl && b.cases.length > 2000) return reject(400, 'At most 2000 cases per upload.');

const ALLOWED = new Set(['case_date', 'case_type', 'value', 'gclid', 'gbraid', 'wbraid', 'email', 'phone', 'call_time']);
for (const row of fromGhl ? [] : b.cases) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return reject(400, 'Every case must be one row of the list.');
  for (const key of Object.keys(row)) {
    if (!ALLOWED.has(key)) {
      return reject(400, `The list has a column that is not allowed: "${String(key).slice(0, 30)}". Keep only case_date, case_type, value, gclid, gbraid, wbraid, email, phone and call_time - no names.`);
    }
  }
}

return [{
  json: {
    valid: true,
    action: b.action,
    client_id: b.client_id,
    customer_id: cid,
    month: b.month,
    again: b.again === true,
    source: fromGhl ? 'ghl' : 'list',
    cases: fromGhl ? [] : b.cases,
  },
}];
