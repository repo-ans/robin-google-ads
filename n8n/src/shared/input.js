// ---- shared/input.js (included by scripts/build-n8n.mjs) -------------------
// Webhook input helpers. The caller always comes from the Auth check block,
// never from the request body.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUSTOMER_RE = /^[0-9]{10}$/;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const requestBody = () => {
  const b = $('Config').first().json.body;
  return b && typeof b === 'object' ? b : {};
};
const caller = () => $('Auth: check role').first().json.user;
const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);
const customerId = (v) => {
  const d = String(v === undefined || v === null ? '' : v).replace(/-/g, '');
  return CUSTOMER_RE.test(d) ? d : null;
};
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// Every "result" item carries { status, body } for the generic Respond node.
const reject = (status, error) => [{ json: { valid: false, status, body: { error } } }];
const reply = (status, body) => [{ json: { status, body } }];
// ---- end shared/input.js ----------------------------------------------------
