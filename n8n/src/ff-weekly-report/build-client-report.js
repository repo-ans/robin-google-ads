// One client's week: the weekly_stats row, the tracking_health snapshot and
// the Google Sheet row. Input: the GHL count response ({ statusCode, body }),
// or the client row itself when GHL is not set up for this client.
// Counts only - GHL contacts are never read or kept (hard rule 4).
const cfg = $('Config').first().json;
const r = $('Loop over clients').first().json;
const input = $input.first().json || {};

const num = (v) => Number(v) || 0;
const money = (micros) => (num(micros) / 1e6).toFixed(2);
const count = (v) => String(Math.round(num(v) * 10) / 10);
const cur = r.currency_code || '';

// GHL leads tagged from Google Ads this week (null = not set up or not readable)
let ghlLeads = null;
const flags = [...(r.account_flags || [])];
if ('statusCode' in input) {
  // This client went through the GHL branch, so its location token ran this pass.
  const token = $('GHL: location token').first().json || {};
  const total = input.body && Number(input.body.total);
  if (!(token.statusCode >= 200 && token.statusCode < 300)) {
    flags.push(`GHL sub-account could not be opened with the FF GHL agency key (status ${token.statusCode || 'none'}) - check GHL_COMPANY_ID and the client's GHL sub-account.`);
  } else if (input.statusCode >= 200 && input.statusCode < 300 && Number.isFinite(total)) {
    ghlLeads = total;
  } else {
    flags.push(`GHL contacts could not be counted (status ${input.statusCode || 'none'}) - check the FF GHL key scopes.`);
  }
}

// Tracking
const tracking = Array.isArray(r.tracking) ? r.tracking : [];
for (const t of tracking) {
  if (t.flag_no_recent_conversions && t.primary_for_goal) {
    flags.push(`"${t.name}" has counted nothing for 14+ days while money is being spent (last: ${t.last_conversion_date || 'never'}).`);
  }
  if (t.flag_call_duration_not_90s) {
    flags.push(`"${t.name}" counts calls of ${t.phone_call_duration_seconds || 'the default'} seconds, not 90.`);
  }
}
if (r.process === 'online_cremation') {
  if (!r.has_purchase_action) flags.push('No purchase conversion action for paid arrangements.');
} else {
  if (!r.has_call_action) flags.push('No call conversion action counting calls of 90s+.');
  if (!r.has_form_action) flags.push('No preplanning form conversion action.');
}
if (num(r.ad_calls_90s_seen) > num(r.calls_90s)) {
  flags.push(`Google saw ${r.ad_calls_90s_seen} ad call(s) of 90s+ but the call conversions counted ${count(r.calls_90s)}.`);
}
if (ghlLeads !== null && ghlLeads > num(r.forms) && r.process !== 'online_cremation') {
  flags.push(`GHL received ${ghlLeads} Google Ads lead(s) but Google Ads counted ${count(r.forms)} form(s).`);
}
if (!r.last_synced_at || Date.parse(r.last_synced_at) < Date.now() - 2 * 86400000) {
  flags.push(`Google Ads data last synced ${r.last_synced_at ? r.last_synced_at.slice(0, 10) : 'never'}.`);
}

// What changed against the week before
const changes = [];
const change = (label, now, before, fmt) => {
  if (!now && !before) return;
  if (!before) { changes.push(`${label} ${fmt(now)} (none the week before).`); return; }
  const p = Math.round(((now - before) / before) * 100);
  if (Math.abs(p) < 10) return;
  changes.push(`${label} ${p > 0 ? 'up' : 'down'} ${Math.abs(p)}%: ${fmt(now)} from ${fmt(before)}.`);
};
change('Spend', num(r.cost_micros), num(r.prev_cost_micros), (v) => `${money(v)} ${cur}`.trim());
if (r.process === 'online_cremation') {
  change('Arrangements', num(r.arrangements), num(r.prev_arrangements), count);
} else {
  change('Calls 90s+', num(r.calls_90s), num(r.prev_calls_90s), count);
  change('Forms', num(r.forms), num(r.prev_forms), count);
}

// What Rob needs to decide
const decisions = [];
if (num(r.ask_rob_terms) > 0) decisions.push(`${r.ask_rob_terms} search term(s) marked ask Rob.`);
if (num(r.unsorted_terms) > 0) decisions.push(`${r.unsorted_terms} new search term(s) with spend to sort: keep, block or ask Rob.`);

const conversions = num(r.conversions);
const stats = {
  client_id: r.client_id,
  week_start: r.week_start,
  week_end: r.week_end,
  currency_code: r.currency_code || null,
  cost_micros: num(r.cost_micros),
  impressions: num(r.impressions),
  clicks: num(r.clicks),
  conversions,
  cost_per_conversion_micros: conversions > 0 ? Math.round(num(r.cost_micros) / conversions) : null,
  calls_90s: num(r.calls_90s),
  ad_calls_90s_seen: num(r.ad_calls_90s_seen),
  forms: num(r.forms),
  arrangements: num(r.arrangements),
  arrangements_value: num(r.arrangements_value),
  arrangements_started: num(r.arrangements_started),
  ghl_google_leads: ghlLeads,
  tracking_ok: flags.length === 0,
  flags,
  changes,
  decisions,
  synced_at: new Date().toISOString(),
};

const trackingRows = tracking.map((t) => ({
  customer_id: t.customer_id,
  conversion_action_id: t.conversion_action_id,
  week_start: r.week_start,
  name: t.name,
  category: t.category || null,
  type: t.type || null,
  status: t.status || null,
  primary_for_goal: t.primary_for_goal ?? null,
  phone_call_duration_seconds: t.phone_call_duration_seconds ?? null,
  last_conversion_date: t.last_conversion_date || null,
  conversions_week: num(t.conversions_week),
  spend_14d_micros: num(t.spend_14d_micros),
  flag_no_recent_conversions: Boolean(t.flag_no_recent_conversions),
  flag_call_duration_not_90s: Boolean(t.flag_call_duration_not_90s),
  synced_at: stats.synced_at,
}));

// Google Sheet row - the keys are the column names in row 1 of the tab.
const sheetRow = {
  Week: r.week_start,
  'Week end': r.week_end,
  Spend: Number(money(r.cost_micros)),
  Currency: cur,
  Clicks: num(r.clicks),
  'Calls 90s+': num(r.calls_90s),
  Forms: num(r.forms),
  Arrangements: num(r.arrangements),
  'Arrangement value': num(r.arrangements_value),
  'Cost per conversion': stats.cost_per_conversion_micros === null ? '' : Number(money(stats.cost_per_conversion_micros)),
  'GHL Google Ads leads': ghlLeads === null ? '' : ghlLeads,
  Tracking: flags.length ? 'Check' : 'OK',
  Flags: flags.join(' ').replace(/[–—]/g, '-'),
  'Needs Rob': decisions.join(' '),
};

return [{
  json: {
    client_id: r.client_id,
    week_start: r.week_start,
    google_sheet_id: r.google_sheet_id || null,
    sheet_tab: cfg.SHEET_TAB,
    stats,
    tracking_rows: trackingRows,
    sheet_row: sheetRow,
  },
}];
