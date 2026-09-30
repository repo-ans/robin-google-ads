// Answer for the generic requests path. Each input is the response to one
// planned request (matched with itemMatching). The first failure wins.
const inputs = $input.all();
let firstData = null;
let message = 'Done.';
for (let i = 0; i < inputs.length; i++) {
  const r = inputs[i].json || {};
  const plan = $('Plan').itemMatching(i).json;
  message = plan.message || message;
  const ok = r.statusCode >= 200 && r.statusCode < 300;
  if (!ok) {
    const body = r.body || {};
    const detail = body.message || body.msg || body.error_description || body.error || (r.error && r.error.message) || `status ${r.statusCode}`;
    const status = r.statusCode === 409 || /duplicate key/i.test(String(detail)) ? 409 : 502;
    const friendly = /clients_slug_key/.test(String(detail)) ? 'A client with that slug already exists.' : String(detail).slice(0, 300);
    return [{ json: { status, body: { error: friendly } } }];
  }
  if (firstData === null) firstData = Array.isArray(r.body) ? r.body[0] ?? null : r.body ?? null;
}
return [{ json: { status: 200, body: { ok: true, message, data: firstData } } }];
