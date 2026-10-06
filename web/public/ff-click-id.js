/*
 * FF click id script for client websites (Funeral Futurist).
 * Served from the FF dashboard: <dashboard URL>/ff-click-id.js
 *
 *   <script src="https://<dashboard>/ff-click-id.js" defer
 *     data-form-conversion="AW-123456789/AbCdEf"      (optional) form conversion, fired on the thank-you page
 *     data-thank-you-path="/thank-you-preplanning"     (optional) path of that page
 *     data-phone-conversion="AW-123456789/GhIjKl"      (optional) website call conversion (calls 90s+)
 *     data-phone="(843) 555-0100"                      (optional) the number shown on the site
 *   Online cremation (Process 2), all optional:
 *     data-start-conversion="AW-123456789/MnOpQr"      arrangement started (fires once per visit)
 *     data-start-path="/arrange"                       the page where the arrangement starts
 *     data-purchase-conversion="AW-123456789/StUvWx"   paid arrangement, with its real value and order id
 *     data-purchase-path="/order-confirmed"            the confirmation page, shown only after a confirmed payment
 *     data-purchase-value-param="total"                URL parameter holding the amount (default "value")
 *     data-purchase-order-param="order"                URL parameter holding the order id (default "order_id")
 *     data-currency="USD">                             (default USD)
 *   ...then the closing script tag. The same code can also be pasted inline
 *   (WPCode or the theme footer) inside a script tag - the data- settings then
 *   go on that tag.
 *
 * What it does:
 *   1. Keeps the Google Ads click id (gclid, gbraid, wbraid) and utm_* values from
 *      the landing page URL for 90 days, in a first-party cookie, so a family that
 *      leaves and comes back days later is still matched to the ad.
 *   2. Puts those values into the GHL form: it adds them to the address of every
 *      GHL form iframe (hidden fields with the same query keys pick them up), and
 *      fills any on-page <input name="gclid"> etc.
 *   3. Optional: fires the form conversion once on the thank-you page, and turns
 *      on Google's website call tracking (Google shows its forwarding number in
 *      place of data-phone; calls ring straight through, no recording or menu).
 *   4. Optional, online cremation: "arrangement started" once per visit, and the
 *      purchase once per order, on the confirmation page only, with the real
 *      amount and the order id (Google also drops a repeat with the same
 *      transaction id). The amount and order id come from, first found:
 *        - the checkout calling  window.ffPurchase({ value: 1995, order_id: 'A-1234', currency: 'USD' })
 *          (or, before this script has loaded: (window.ffPurchaseQueue = window.ffPurchaseQueue || []).push({...}))
 *        - the confirmation page address  ?value=1995&order_id=A-1234  (names set by the data-purchase-*-param options)
 *        - an element on the page  <span data-ff-purchase-value="1995" data-ff-order-id="A-1234"></span>
 *      No amount or no order id means no purchase is sent - it never guesses.
 *
 * Nothing personal is read or stored: only the click id and utm values. Needs the
 * Google tag (gtag.js) on the site for step 3 only. Plain hyphens, no emoji.
 */
(function () {
  'use strict';
  var KEYS = ['gclid', 'gbraid', 'wbraid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
  var CLICK_KEYS = ['gclid', 'gbraid', 'wbraid'];
  var COOKIE = 'ff_click';
  var DAYS = 90;
  var GHL_FORM = /\/widget\/(form|survey|booking)\//;
  var script = document.currentScript;
  var opt = function (name) { return (script && script.getAttribute('data-' + name)) || ''; };

  var clean = function (v) { return typeof v === 'string' ? v.replace(/[^\w.~+%\- ]/g, '').slice(0, 300) : ''; };
  var hasClick = function (o) { return CLICK_KEYS.some(function (k) { return o && o[k]; }); };

  function readCookie() {
    var m = document.cookie.match(new RegExp('(?:^|; )' + COOKIE + '=([^;]*)'));
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch (e) { return null; }
  }
  function readStored() {
    var v = readCookie();
    if (!v) {
      try { v = JSON.parse(window.localStorage.getItem(COOKIE) || 'null'); } catch (e) { v = null; }
    }
    if (!v || typeof v !== 'object' || !(Number(v.ts) > Date.now() - DAYS * 86400000)) return null;
    return v;
  }
  function store(v) {
    var value = encodeURIComponent(JSON.stringify(v));
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = COOKIE + '=' + value + '; Max-Age=' + DAYS * 86400 + '; Path=/; SameSite=Lax' + secure;
    try { window.localStorage.setItem(COOKIE, JSON.stringify(v)); } catch (e) { /* private mode */ }
  }

  // 1. Capture: a new ad click replaces what we had; utm values alone never
  //    overwrite an earlier ad click.
  var fromUrl = {};
  try {
    var params = new URLSearchParams(location.search);
    KEYS.forEach(function (k) { var v = clean(params.get(k)); if (v) fromUrl[k] = v; });
  } catch (e) { /* very old browser */ }
  var saved = readStored();
  var values = saved;
  if (hasClick(fromUrl) || (Object.keys(fromUrl).length && !hasClick(saved))) {
    values = fromUrl;
    values.ts = Date.now();
    store(values);
  }
  values = values || {};

  // 2. Fill forms
  function fillInputs(root) {
    KEYS.forEach(function (k) {
      if (!values[k]) return;
      var inputs = (root || document).querySelectorAll('input[name="' + k + '"], input[data-ff="' + k + '"]');
      Array.prototype.forEach.call(inputs, function (el) { if (!el.value) el.value = values[k]; });
    });
  }
  function fillIframe(frame) {
    var attr = frame.getAttribute('src') ? 'src' : (frame.getAttribute('data-src') ? 'data-src' : null);
    if (!attr) return;
    var src = frame.getAttribute(attr);
    if (!GHL_FORM.test(src)) return;
    var url;
    try { url = new URL(src, location.href); } catch (e) { return; }
    var changed = false;
    KEYS.forEach(function (k) {
      if (values[k] && !url.searchParams.get(k)) { url.searchParams.set(k, values[k]); changed = true; }
    });
    if (changed) frame.setAttribute(attr, url.toString());
  }
  function fillAll() {
    if (!Object.keys(values).length) return;
    fillInputs(document);
    Array.prototype.forEach.call(document.querySelectorAll('iframe'), fillIframe);
  }

  // 3. Optional Google Ads conversions (need gtag.js on the page)
  function gtagReady() { return typeof window.gtag === 'function'; }
  function formConversion() {
    var sendTo = opt('form-conversion');
    var path = opt('thank-you-path');
    if (!sendTo || !path || location.pathname.replace(/\/+$/, '') !== path.replace(/\/+$/, '')) return;
    var key = 'ff_form_conv_' + sendTo;
    try { if (window.sessionStorage.getItem(key)) return; } catch (e) { /* ignore */ }
    if (!gtagReady()) return;
    window.gtag('event', 'conversion', { send_to: sendTo });
    try { window.sessionStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
  }
  function phoneConversion() {
    var sendTo = opt('phone-conversion');
    var phone = opt('phone');
    if (!sendTo || !phone || !gtagReady()) return;
    window.gtag('config', sendTo, { phone_conversion_number: phone });
  }

  // 4. Online cremation: arrangement started and purchase
  var onPath = function (path) { return path && location.pathname.replace(/\/+$/, '') === path.replace(/\/+$/, ''); };
  function startConversion() {
    var sendTo = opt('start-conversion');
    if (!sendTo || !onPath(opt('start-path')) || !gtagReady()) return;
    var key = 'ff_start_conv_' + sendTo;
    try { if (window.sessionStorage.getItem(key)) return; } catch (e) { /* ignore */ }
    window.gtag('event', 'conversion', { send_to: sendTo });
    try { window.sessionStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
  }
  var purchaseSent = false;
  function sendPurchase(p) {
    var sendTo = opt('purchase-conversion');
    if (purchaseSent || !sendTo || !gtagReady() || !p) return false;
    var path = opt('purchase-path');
    if (path && !onPath(path)) return false;
    var value = Math.round(Number(String(p.value).replace(/[^0-9.]/g, '')) * 100) / 100;
    var orderId = clean(String(p.order_id || '')).replace(/ /g, '').slice(0, 64);
    if (!(value > 0) || !orderId) return false;
    var key = 'ff_purchase_' + orderId;
    try { if (window.localStorage.getItem(key)) return false; } catch (e) { /* ignore */ }
    window.gtag('event', 'conversion', {
      send_to: sendTo, value: value, currency: (p.currency || opt('currency') || 'USD').toUpperCase().slice(0, 3), transaction_id: orderId,
    });
    purchaseSent = true;
    try { window.localStorage.setItem(key, String(Date.now())); } catch (e) { /* ignore */ }
    return true;
  }
  function purchaseFromPage() {
    if (!opt('purchase-conversion') || !opt('purchase-path') || !onPath(opt('purchase-path'))) return;
    var params;
    try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
    var fromUrl = params && {
      value: params.get(opt('purchase-value-param') || 'value'),
      order_id: params.get(opt('purchase-order-param') || 'order_id'),
      currency: params.get('currency'),
    };
    if (fromUrl && fromUrl.value && fromUrl.order_id && sendPurchase(fromUrl)) return;
    var el = document.querySelector('[data-ff-purchase-value][data-ff-order-id]');
    if (el) sendPurchase({ value: el.getAttribute('data-ff-purchase-value'), order_id: el.getAttribute('data-ff-order-id'), currency: el.getAttribute('data-ff-currency') });
  }
  // For a checkout that knows the amount in JavaScript: call after the payment is confirmed.
  window.ffPurchase = function (p) { return sendPurchase(p || {}); };
  // A checkout that runs before this script can queue it: (window.ffPurchaseQueue = window.ffPurchaseQueue || []).push({...})
  function drainQueue() {
    var q = window.ffPurchaseQueue;
    if (Array.isArray(q)) q.forEach(function (p) { sendPurchase(p); });
    window.ffPurchaseQueue = { push: function (p) { return sendPurchase(p); } };
  }

  function start() {
    fillAll();
    formConversion();
    phoneConversion();
    startConversion();
    purchaseFromPage();
    drainQueue();
    if (window.MutationObserver && Object.keys(values).length) {
      new MutationObserver(function (records) {
        records.forEach(function (r) {
          Array.prototype.forEach.call(r.addedNodes || [], function (n) {
            if (n.nodeType !== 1) return;
            if (n.tagName === 'IFRAME') fillIframe(n);
            else {
              Array.prototype.forEach.call(n.querySelectorAll ? n.querySelectorAll('iframe') : [], fillIframe);
              fillInputs(n);
            }
          });
          if (r.type === 'attributes' && r.target.tagName === 'IFRAME') fillIframe(r.target);
        });
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'data-src'] });
    }
  }

  // For checking on a live page: ffClickIds() in the browser console.
  window.ffClickIds = function () { return JSON.parse(JSON.stringify(values)); };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
