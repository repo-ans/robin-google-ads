// @include shared/sha256.js
// Turns the no-name case list into Google Ads conversion uploads, after the guards.
//
// Per case, the first that fits:
//   gclid / gbraid / wbraid           -> click conversion (plus hashed email/phone if given)
//   phone + call_time                 -> call conversion (calls through a Google forwarding number)
//   email and/or phone, no call_time  -> enhanced conversion for leads (SHA-256 hashed email/phone)
//   none of these                     -> skipped
// Cases whose date (or first call) is more than 90 days ago are "unattributed":
// Google only matches conversions within 90 days of the click or call, so they are
// counted apart, never as failures.
// Conversion actions (made by Rob's "Set up call tracking" on the client page):
//   "Case signed"          Import > CRM / clicks (UPLOAD_CLICKS)
//   "Case signed - calls"  Import > calls       (UPLOAD_CALLS)
// The older names "FF - Signed case" / "FF - Signed case call" still count.
//
// Output: { ok, status?, error?, uploads: [{ kind, url_suffix, body, sent }], counts, ... }
// Nothing personal leaves this node except inside the upload bodies, which go
// only to Google Ads. Counts and reason names are what get saved.
const v = $('Validate input').first().json;
const ctx = $('Get case match context').first().json || {};
const earlier = $('Get earlier uploads').all().map((i) => i.json).filter((r) => r && r.id);

// The cases: the uploaded list, or (source "ghl") the won opportunities n8n just read from GHL.
let cases = v.cases;
let ghl = null;
if (v.source === 'ghl') {
  ghl = $('GHL: build cases').first().json;
  cases = ghl.cases || [];
}
const refuse = (status, error) => [{ json: { ok: false, status, error, ctx, counts: { cases_in: cases.length } } }];
if (ghl && ghl.error) return refuse(502, ghl.error);
if (ghl && !cases.length) return refuse(404, `No won opportunities in GHL for ${v.month}. In GHL, set an opportunity to "Won" when a family signs.`);

if (!ctx.found || !ctx.customer_id) return refuse(404, 'That Google Ads account is not linked to this client.');
if (v.action === 'upload' && !ctx.is_test_account && !ctx.writes_enabled) {
  return refuse(403, 'Writes are not turned on for this client yet. Test on the Google Ads test account first, then Rob can turn writes on in the client settings.');
}
if (v.action === 'upload' && earlier.length && !v.again) {
  const when = String(earlier[0].created_at || '').slice(0, 10);
  return refuse(409, `Cases for ${v.month} were already uploaded on ${when}. Upload only cases that were not in that list, and tick "These are new cases".`);
}

const tz = ctx.time_zone || 'UTC';
const cur = ctx.currency_code || null;
const defaultValue = ctx.case_value_micros ? Number(ctx.case_value_micros) / 1e6 : null;
const action = (a) => (a && a.id ? `customers/${ctx.customer_id}/conversionActions/${a.id}` : null);
const clickAction = action(ctx.click_action);
const callAction = action(ctx.call_action);

// "2026-09-14 12:00:00" in the account time zone -> "2026-09-14 12:00:00-04:00"
function withOffset(day, time) {
  const guess = new Date(`${day}T${time}Z`);
  if (Number.isNaN(guess.getTime())) return null;
  let offsetMin = 0;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(guess);
    const get = (k) => Number(parts.find((p) => p.type === k).value);
    const asZone = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    offsetMin = Math.round((asZone - guess.getTime()) / 60000);
  } catch (e) {
    offsetMin = 0;
  }
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `${day} ${time}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

const validDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) && !Number.isNaN(new Date(`${s.trim()}T00:00:00Z`).getTime());
const clickId = (s) => (typeof s === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(s.trim()) ? s.trim() : null);
function phoneE164(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;            // US / Canada
  if (digits.length === 11 && digits[0] === '1') return `+${digits}`;
  return null;
}
function emailNorm(raw) {
  if (typeof raw !== 'string') return null;
  let e = raw.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return null;
  const [local, domain] = e.split('@');
  if (domain === 'gmail.com' || domain === 'googlemail.com') e = `${local.replace(/\./g, '')}@${domain}`;
  return e;
}
function callTime(raw) {
  if (typeof raw !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  return m ? withOffset(m[1], `${m[2]}:${m[3]}:${m[4] || '00'}`) : null;
}

const counts = { cases_in: cases.length, skipped: 0, unattributed: 0, value_total: 0 };
const caseTypes = {};
const todayUtc = new Date();
const cutoff = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), todayUtc.getUTCDate()) - 90 * 86400000)
  .toISOString().slice(0, 10);
const reasons = {};
const skip = (why) => { counts.skipped++; reasons[why] = (reasons[why] || 0) + 1; };
const click = [];
const call = [];

for (const row of cases) {
  const day = validDay(row.case_date) ? row.case_date.trim() : null;
  if (!day) { skip('case_date missing or not YYYY-MM-DD'); continue; }
  if (day.slice(0, 7) !== v.month) { skip('case_date outside the month'); continue; }
  const type = typeof row.case_type === 'string' && row.case_type.trim()
    ? row.case_type.trim().toLowerCase().replace(/[^a-z0-9 -]+/g, '').slice(0, 30) || 'other' : 'not given';
  caseTypes[type] = (caseTypes[type] || 0) + 1;
  const firstContact = typeof row.call_time === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row.call_time.trim()) ? row.call_time.trim().slice(0, 10) : day;
  if (firstContact < cutoff) { counts.unattributed++; continue; }
  const n = row.value === undefined || row.value === null || row.value === '' ? defaultValue : Number(row.value);
  const value = n !== null && Number.isFinite(n) && n >= 0 && n < 1000000 ? Math.round(n * 100) / 100 : null;
  const signedAt = withOffset(day, '12:00:00');
  const ids = { gclid: clickId(row.gclid), gbraid: clickId(row.gbraid), wbraid: clickId(row.wbraid) };
  const phone = phoneE164(row.phone);
  const email = emailNorm(row.email);
  const calledAt = callTime(row.call_time);
  const money = value !== null ? { conversionValue: value, ...(cur ? { currencyCode: cur } : {}) } : {};
  const identifiers = [
    ...(email ? [{ hashedEmail: sha256(email) }] : []),
    ...(phone ? [{ hashedPhoneNumber: sha256(phone) }] : []),
  ];
  // Order id: a hash, so a case uploaded twice is counted once by Google.
  const orderId = `ff-${sha256(`${v.client_id}|${day}|${ids.gclid || ids.gbraid || ids.wbraid || email || phone || ''}`).slice(0, 28)}`;

  const idKey = ids.gclid ? 'gclid' : ids.gbraid ? 'gbraid' : ids.wbraid ? 'wbraid' : null;
  if (idKey || (!calledAt && identifiers.length)) {
    if (!clickAction) { skip('no "Case signed" conversion action yet - Rob: client page > Call tracking > Set up call tracking'); continue; }
    click.push({
      ...(idKey ? { [idKey]: ids[idKey] } : {}),
      conversionAction: clickAction,
      conversionDateTime: signedAt,
      orderId,
      ...money,
      ...(identifiers.length ? { userIdentifiers: identifiers } : {}),
    });
  } else if (phone && calledAt) {
    if (!callAction) { skip('no "Case signed - calls" conversion action yet - Rob: client page > Call tracking > Set up call tracking'); continue; }
    call.push({ callerId: phone, callStartDateTime: calledAt, conversionAction: callAction, conversionDateTime: signedAt, ...money });
  } else {
    skip(row.phone && !phone ? 'phone not readable' : row.call_time && !calledAt ? 'call_time not YYYY-MM-DD HH:MM' : 'no click id, phone or email');
    continue;
  }
  if (value !== null) counts.value_total += value;
}
counts.value_total = Math.round(counts.value_total * 100) / 100;

const uploads = [];
if (click.length) uploads.push({ kind: 'click', url_suffix: ':uploadClickConversions', sent: click.length, body: { conversions: click, partialFailure: true } });
if (call.length) uploads.push({ kind: 'call', url_suffix: ':uploadCallConversions', sent: call.length, body: { conversions: call, partialFailure: true } });

if (!uploads.length) {
  const why = counts.unattributed === counts.cases_in
    ? 'Every case is older than 90 days, so Google cannot match them (counted as unattributed).'
    : 'No case could be sent: each needs a click id, an email or phone, or a phone and call time.';
  return [{ json: { ok: false, status: 422, error: why, ctx, counts: { ...counts, matched: 0, case_types: caseTypes }, reasons } }];
}

return [{
  json: {
    ok: true,
    ctx,
    action: v.action,
    customer_id: ctx.customer_id,
    login_customer_id: ctx.login_customer_id || null,
    uploads,
    counts: { ...counts, sent_click: click.length, sent_call: call.length, matched: click.length + call.length, case_types: caseTypes },
    reasons,
  },
}];
