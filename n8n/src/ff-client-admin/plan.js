// @include shared/input.js
// Everything FF staff do to clients, accounts and logins. Body { action, ... }:
//   create_client      { name, slug?, website_url?, phone?, towns?, process?, currency_code?, case_value?,
//                        competitor_terms?, own_brand_terms?, slack_channel?, ghl_location_id?,
//                        dataforseo_location_code?, language_code?, office_hours? }
//   update_client      { client_id, ...same fields }
//   archive_client / unarchive_client { client_id }
//   set_writes_enabled { client_id, enabled }                      rob_admin only
//   assign_account     { customer_id, client_id | null }            null = back to Unassigned
//   add_account        { customer_id, login_customer_id?, client_id? }   direct-access accounts
//   set_account_sync   { customer_id, sync_enabled }
//   create_login       { client_id, email, password }              a client_viewer login
//   create_staff_login { email, password, role: ff_staff | rob_admin }   rob_admin only
//   reset_password     { user_id, password }
//   disable_login / enable_login { user_id }
// FF staff manage client logins; only rob_admin manages FF staff logins.
// Input: the profiles row of body.user_id (empty when not given).
const b = requestBody();
const user = caller();
const target = $input.first().json || {};
const isRob = user.role === 'rob_admin';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const passwordOk = (p) => typeof p === 'string' && p.length >= 10 && p.length <= 72 && /[A-Za-z]/.test(p) && /[0-9]/.test(p);
const list = (v, max = 50) => (Array.isArray(v) ? v.map((x) => text(String(x), 100)).filter(Boolean).slice(0, max) : []);
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

// Only these client fields can be set, each checked.
function clientFields(src) {
  const f = {};
  const errors = [];
  if ('name' in src) { f.name = text(src.name, 120); if (f.name.length < 2) errors.push('Name is required.'); }
  if ('website_url' in src) {
    const u = text(src.website_url, 300);
    if (u && !/^https?:\/\/\S+\.\S+$/.test(u)) errors.push('Website must start with https://');
    f.website_url = u || null;
  }
  if ('phone' in src) f.phone = text(src.phone, 40) || null;
  if ('towns' in src) f.towns = list(src.towns);
  if ('service_area_notes' in src) f.service_area_notes = text(src.service_area_notes, 1000) || null;
  if ('process' in src) {
    if (!['funeral_home', 'online_cremation'].includes(src.process)) errors.push('Process must be funeral_home or online_cremation.');
    else f.process = src.process;
  }
  if ('currency_code' in src) {
    const c = String(src.currency_code || '').toUpperCase();
    if (c && !/^[A-Z]{3}$/.test(c)) errors.push('Currency must be a 3-letter code like USD.');
    f.currency_code = c || null;
  }
  if ('case_value' in src) {
    const n = Number(src.case_value);
    if (src.case_value !== null && src.case_value !== '' && !(n >= 0)) errors.push('Case value must be a number.');
    f.case_value_micros = src.case_value === null || src.case_value === '' ? null : Math.round(n * 1e6);
  }
  if ('ghl_location_id' in src) f.ghl_location_id = text(src.ghl_location_id, 100) || null;
  if ('competitor_terms' in src) f.competitor_terms = list(src.competitor_terms);
  if ('own_brand_terms' in src) f.own_brand_terms = list(src.own_brand_terms);
  if ('slack_channel' in src) f.slack_channel = text(src.slack_channel, 80) || null;
  if ('dataforseo_location_code' in src) {
    const n = Number(src.dataforseo_location_code);
    if (!Number.isInteger(n) || n <= 0) errors.push('DataForSEO location code must be a number, e.g. 2840 for the US.');
    else f.dataforseo_location_code = n;
  }
  if ('language_code' in src) {
    if (!['en', 'fr', 'es'].includes(src.language_code)) errors.push('Language must be en, fr or es.');
    else f.language_code = src.language_code;
  }
  if ('office_hours' in src) {
    const o = src.office_hours || {};
    const days = (Array.isArray(o.days) ? o.days : []).filter((d) => DAYS.includes(d));
    const sh = Number(o.start_hour);
    const eh = Number(o.end_hour);
    if (!days.length || !(sh >= 0 && sh < 24) || !(eh > sh && eh <= 24)) errors.push('Office hours need days and a start hour before the end hour.');
    else f.office_hours = { days, start_hour: sh, end_hour: eh };
  }
  return { f, errors };
}

const req = (method, path, body, prefer = 'return=representation') => ({ method, path, body, prefer });
const run = (requests, message) => requests.map((r) => ({ json: { valid: true, kind: 'requests', message, ...r } }));

function targetCheck(action) {
  if (!isUuid(b.user_id)) return 'user_id is missing or not valid.';
  if (!target.user_id) return 'Login not found.';
  if (target.role !== 'client_viewer' && !isRob) return 'Only Rob can change FF staff logins.';
  if (action === 'disable_login' && target.user_id === user.user_id) return 'You cannot turn off your own login.';
  return null;
}

switch (b.action) {
  case 'create_client': {
    const { f, errors } = clientFields(b);
    if (!f.name) errors.push('Name is required.');
    const slug = slugify(b.slug || b.name || '');
    if (slug.length < 2) errors.push('Slug is required.');
    if (errors.length) return reject(400, errors.join(' '));
    return run([req('POST', 'rest/v1/clients', { ...f, slug })], 'Client created.');
  }
  case 'update_client': {
    if (!isUuid(b.client_id)) return reject(400, 'client_id is missing or not valid.');
    const { f, errors } = clientFields(b);
    if (errors.length) return reject(400, errors.join(' '));
    if (!Object.keys(f).length) return reject(400, 'Nothing to change.');
    return run([req('PATCH', `rest/v1/clients?id=eq.${b.client_id}`, f)], 'Client updated.');
  }
  case 'archive_client':
  case 'unarchive_client': {
    if (!isUuid(b.client_id)) return reject(400, 'client_id is missing or not valid.');
    const archived = b.action === 'archive_client' ? new Date().toISOString() : null;
    return run([req('PATCH', `rest/v1/clients?id=eq.${b.client_id}`, { archived_at: archived })],
      archived ? 'Client archived.' : 'Client restored.');
  }
  case 'set_writes_enabled': {
    if (!isRob) return reject(403, 'Only Rob can turn Google Ads writes on or off.');
    if (!isUuid(b.client_id)) return reject(400, 'client_id is missing or not valid.');
    return run([req('PATCH', `rest/v1/clients?id=eq.${b.client_id}`, { writes_enabled: b.enabled === true })],
      b.enabled === true ? 'Writes turned on for this client.' : 'Writes turned off for this client.');
  }
  case 'assign_account': {
    const cid = customerId(b.customer_id);
    if (!cid) return reject(400, 'customer_id must be 10 digits.');
    if (b.client_id !== null && !isUuid(b.client_id)) return reject(400, 'client_id is not valid.');
    return run([req('PATCH', `rest/v1/ad_accounts?customer_id=eq.${cid}`, { client_id: b.client_id })],
      b.client_id ? 'Account assigned.' : 'Account moved to Unassigned.');
  }
  case 'add_account': {
    const cid = customerId(b.customer_id);
    if (!cid) return reject(400, 'customer_id must be 10 digits.');
    const login = b.login_customer_id ? customerId(b.login_customer_id) : null;
    if (b.login_customer_id && !login) return reject(400, 'login_customer_id must be 10 digits, or empty for direct access.');
    if (b.client_id && !isUuid(b.client_id)) return reject(400, 'client_id is not valid.');
    return run([req('POST', 'rest/v1/ad_accounts?on_conflict=customer_id',
      [{ customer_id: cid, login_customer_id: login, client_id: b.client_id || null }],
      'resolution=merge-duplicates,return=representation')], 'Account added. It will sync on the next run.');
  }
  case 'set_account_sync': {
    const cid = customerId(b.customer_id);
    if (!cid) return reject(400, 'customer_id must be 10 digits.');
    return run([req('PATCH', `rest/v1/ad_accounts?customer_id=eq.${cid}`, { sync_enabled: b.sync_enabled === true })],
      b.sync_enabled === true ? 'Sync turned on.' : 'Sync turned off.');
  }
  case 'create_login':
  case 'create_staff_login': {
    const email = text(b.email, 200).toLowerCase();
    if (!EMAIL_RE.test(email)) return reject(400, 'Enter a valid email address.');
    if (!passwordOk(b.password)) return reject(400, 'Password: at least 10 characters, with letters and numbers.');
    let role = 'client_viewer';
    let clientId = null;
    if (b.action === 'create_staff_login') {
      if (!isRob) return reject(403, 'Only Rob can create FF staff logins.');
      if (!['ff_staff', 'rob_admin'].includes(b.role)) return reject(400, 'Role must be ff_staff or rob_admin.');
      role = b.role;
    } else {
      if (!isUuid(b.client_id)) return reject(400, 'client_id is missing or not valid.');
      clientId = b.client_id;
    }
    return [{ json: { valid: true, kind: 'create_login', email, password: b.password, role, client_id: clientId } }];
  }
  case 'reset_password': {
    const problem = targetCheck(b.action);
    if (problem) return reject(problem === 'Login not found.' ? 404 : 403, problem);
    if (!passwordOk(b.password)) return reject(400, 'Password: at least 10 characters, with letters and numbers.');
    return run([req('PUT', `auth/v1/admin/users/${target.user_id}`, { password: b.password })], 'Password changed.');
  }
  case 'disable_login':
  case 'enable_login': {
    const problem = targetCheck(b.action);
    if (problem) return reject(problem === 'Login not found.' ? 404 : 403, problem);
    const off = b.action === 'disable_login';
    return run([
      req('PUT', `auth/v1/admin/users/${target.user_id}`, { ban_duration: off ? '876000h' : 'none' }),
      req('PATCH', `rest/v1/profiles?user_id=eq.${target.user_id}`, { disabled: off }),
    ], off ? 'Login turned off.' : 'Login turned on.');
  }
  default:
    return reject(400, 'Unknown action.');
}
