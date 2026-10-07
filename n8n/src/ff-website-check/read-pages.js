// Reads each fetched public page (no login) and records what is on it - never
// any text or personal data from the page, only yes/no answers, tag ids and a
// count of phone links. Each answer is matched to its page with itemMatching(i).
// Pages built in the browser (some site builders) or tags loaded through Google
// Tag Manager may not show in the HTML; the dashboard says so.
const now = new Date().toISOString();
const rows = [];
$input.all().forEach((item, i) => {
  const page = $('Pages').itemMatching(i).json;
  const r = item.json || {};
  const ok = r.statusCode >= 200 && r.statusCode < 400;
  const html = typeof r.body === 'string' ? r.body.slice(0, 3000000) : typeof r.data === 'string' ? r.data.slice(0, 3000000) : '';
  const h = html.toLowerCase();
  const has = (re) => re.test(h);

  const ids = [...new Set((html.match(/\b(AW-\d{6,12}|G-[A-Z0-9]{6,12}|GTM-[A-Z0-9]{4,10})\b/g) || []))].slice(0, 10);
  const ffSettings = ['phone-conversion', 'form-conversion', 'thank-you-path', 'start-conversion', 'purchase-conversion', 'purchase-path']
    .filter((k) => h.includes(`data-${k}`));
  const ghlForm = has(/(leadconnectorhq\.com|msgsndr\.com)\/widget\/(form|survey|booking)|form_embed\.js/);
  const leadForm = ghlForm || has(/<form[\s\S]{0,6000}?(type=["']?(email|tel)\b|name=["']?(email|phone)\b)/);
  let checkout = null;
  if (has(/js\.stripe\.com|checkout\.stripe\.com|buy\.stripe\.com/)) checkout = 'stripe';
  else if (has(/woocommerce/)) checkout = 'woocommerce';
  else if (has(/paypal\.com\/sdk|paypalobjects\.com/)) checkout = 'paypal';
  else if (has(/squareup\.com|square\.site/)) checkout = 'square';
  else if (has(/(leadconnectorhq\.com|msgsndr\.com)[^"']*(order|payment)|order-form/)) checkout = 'ghl order form';
  else if (has(/href=["'][^"']*(checkout|arrange-online|arrange-now|pay-online|pay-now)[^"']*["']/)) checkout = 'checkout link';
  let platform = 'other';
  if (has(/wp-content|wp-includes/)) platform = 'wordpress';
  else if (has(/assets\.cdn\.filesafe\.space|leadconnectorhq|msgsndr/) && has(/__nuxt|nuxt/)) platform = 'ghl';
  else if (has(/wixstatic\.com|wix\.com/)) platform = 'wix';
  else if (has(/squarespace/)) platform = 'squarespace';
  else if (has(/cdn\.shopify\.com/)) platform = 'shopify';

  rows.push({
    client_id: page.client_id,
    url: page.url,
    checked_at: now,
    status_code: r.statusCode || null,
    error: ok ? null : String((r.error && r.error.message) || `status ${r.statusCode || 'none'}`).slice(0, 200),
    platform: ok ? platform : null,
    has_ff_script: ok && h.includes('ff-click-id.js'),
    ff_settings: ok ? ffSettings : [],
    has_gtag: ok && has(/googletagmanager\.com\/gtag\/js|gtag\(/),
    gtag_ids: ok ? ids : [],
    has_gtm: ok && has(/googletagmanager\.com\/gtm\.js|\bgtm-[a-z0-9]{4,10}\b/),
    has_ghl_form: ok && ghlForm,
    has_form: ok && leadForm,
    has_checkout: ok && Boolean(checkout),
    checkout_hint: ok ? checkout : null,
    phones_seen: ok ? (h.match(/href=["']tel:/g) || []).length : 0,
  });
});
return [{ json: { rows, count: rows.length } }];
