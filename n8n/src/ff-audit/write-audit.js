// ff_audit_data -> Markdown audit + summary + issues (PLAN.md Phase 5 content:
// campaigns, settings, conversion tracking, 90 days of search terms, negatives,
// issues found). Read only. Search terms are already name-filtered.
// Calm tone, plain hyphens, no emoji.
const v = $('Validate input').first().json;
const acctRow = $('Get account').first().json || {};
const user = $('Auth: check role').first().json.user;
const d = $input.first().json || {};
const a = d.account || {};
const cur = a.currency || '';
const period = d.period || {};
const campaigns = d.campaigns || [];
const conv = d.conversion_actions || [];
const kw = d.keywords || {};

const n = (x) => Number(x || 0);
const m = (x) => `${n(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`.trim();
const pct = (x) => (x === null || x === undefined ? 'n/a' : `${Math.round(n(x) * 100)}%`);
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/\|/g, '/').replace(/\n/g, ' ');
const table = (head, rows) => rows.length
  ? [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n')
  : '_None._';

const totalCost = campaigns.reduce((s, c) => s + n(c.cost), 0);
const totalConv = campaigns.reduce((s, c) => s + n(c.conversions), 0);
const totalClicks = campaigns.reduce((s, c) => s + n(c.clicks), 0);
const wasted = (d.search_terms_wasted || []).reduce((s, t) => s + n(t.cost), 0);
const calls = d.calls || {};
const geo = d.geo || {};

// ---- Issues found, most important first
const issues = [];
const add = (severity, textValue) => issues.push({ severity, text: textValue });
if (a.auto_tagging === false) add('high', 'Auto-tagging is off. Forms cannot capture the GCLID, so signed cases cannot be matched back to ads.');
if (a.call_reporting === false) add('high', 'Call reporting is off. Calls of 90 seconds or more cannot be counted.');
const callActions = conv.filter((c) => ['AD_CALL', 'WEBSITE_CALL'].includes(c.type) && c.status === 'ENABLED');
if (!callActions.length) add('high', 'There is no enabled call conversion action (calls from ads or from the website).');
for (const c of callActions.filter((x) => x.call_not_90s)) add('medium', `Call action "${c.name}" counts calls of ${c.call_seconds ?? 'the default'} seconds. The SOP asks for 90 seconds.`);
for (const c of conv.filter((x) => x.no_recent)) add('high', `Conversion action "${c.name}" has had spend but no conversions for 14+ days (last: ${c.last_conversion || 'never'}).`);
if (!conv.some((c) => c.status === 'ENABLED' && c.primary)) add('high', 'No enabled primary conversion action - bidding has nothing to aim for.');
for (const c of campaigns) {
  if (c.geo_type && c.geo_type !== 'PRESENCE') add('medium', `"${c.name}" also targets people only interested in the area. The SOP asks for presence only.`);
  if (c.network_partners || c.network_display) add('medium', `"${c.name}" runs on the Search Partners or Display network. The SOP asks for Google Search only.`);
  if (n(c.budget_lost_is) > 0.2) add('medium', `"${c.name}" lost ${pct(c.budget_lost_is)} of possible impressions to budget.`);
  if (n(c.rank_lost_is) > 0.3) add('low', `"${c.name}" lost ${pct(c.rank_lost_is)} of possible impressions to ad rank.`);
  if (!c.locations) add('high', `"${c.name}" has no location targeting.`);
}
if (n(kw.broad) > 0) add('medium', `${kw.broad} active keyword(s) use broad match. The SOP asks for phrase or exact only.`);
for (const g of (d.ad_groups_keyword_counts || []).filter((x) => n(x.keywords) < 5 || n(x.keywords) > 15)) {
  add('low', `Ad group "${g.ad_group}" has ${g.keywords} keywords. The SOP asks for 5 to 15.`);
}
if (n(kw.low_quality) > 0) add('low', `${kw.low_quality} keyword(s) have a Quality Score below 5.`);
if (d.ads && n(d.ads.disapproved) > 0) add('high', `${d.ads.disapproved} enabled ad(s) are disapproved.`);
if (!(d.shared_lists || []).length) add('medium', 'No shared negative keyword list. The SOP uses one universal list.');
if (wasted > 0) add('medium', `${m(wasted)} went to the top search terms with clicks but no conversions in 90 days (see the list below).`);
if (n(geo.interest_cost) > 0) add('medium', `${m(geo.interest_cost)} was spent on people outside the target area (area of interest).`);
if (!n(d.assets && d.assets.CALL)) add('medium', 'No call asset (call extension) found.');
if ((d.recommendations || []).length) add('low', `${d.recommendations.length} Google recommendation(s) are open - review, do not auto-apply.`);
if (n(d.changes_30d && d.changes_30d.GOOGLE_ADS_API) > 0) add('low', `${d.changes_30d.GOOGLE_ADS_API} change(s) in the last 30 days came through the API.`);
const order = { high: 0, medium: 1, low: 2 };
issues.sort((x, y) => order[x.severity] - order[y.severity]);

// ---- Markdown
const title = `${acctRow.clients ? acctRow.clients.name : 'Client'} - Google Ads audit`;
const md = [
  `# ${title}`,
  '',
  `Account ${a.name || ''} (${String(a.customer_id || '').replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')}) - period ${period.from} to ${period.to}.`,
  `Read only: nothing was changed in Google Ads to make this report. Generated ${new Date().toISOString().slice(0, 10)}.`,
  '',
  '## Summary',
  '',
  `- Spend: ${m(totalCost)} over ${campaigns.length} campaign(s) with spend`,
  `- Clicks: ${totalClicks.toLocaleString('en-US')}; conversions: ${Math.round(totalConv * 100) / 100}`,
  `- Calls: ${n(calls.total)} (${n(calls.over_90s)} of 90 seconds or more, ${n(calls.missed)} missed)`,
  `- Issues found: ${issues.filter((i) => i.severity === 'high').length} high, ${issues.filter((i) => i.severity === 'medium').length} medium, ${issues.filter((i) => i.severity === 'low').length} low`,
  '',
  '## Issues found',
  '',
  ...(issues.length ? issues.map((i) => `- **${i.severity}** - ${i.text}`) : ['- Nothing stood out.']),
  '',
  '## Account settings',
  '',
  table(['Setting', 'Value'], [
    ['Currency / time zone', `${cur} / ${a.time_zone || ''}`],
    ['Auto-tagging', a.auto_tagging ? 'on' : 'off'],
    ['Call reporting', a.call_reporting ? 'on' : 'off'],
    ['Call conversion reporting', a.call_conversion_reporting ? 'on' : 'off'],
    ['Conversion tracking', a.conversion_tracking_status || 'unknown'],
    ['Enhanced conversions for leads', a.enhanced_conversions_for_leads ? 'on' : 'off'],
    ['Test account', a.is_test_account ? 'yes' : 'no'],
  ]),
  '',
  '## Campaigns (last 90 days)',
  '',
  table(['Campaign', 'Status', 'Bidding', 'Budget/day', 'Cost', 'Clicks', 'Conv.', 'Search IS', 'Lost IS (budget)', 'Locations', 'Schedule slots'],
    campaigns.map((c) => [c.name, c.status, c.bidding, m(c.daily_budget), m(c.cost), c.clicks, c.conversions, pct(c.search_is), pct(c.budget_lost_is), c.locations || 'none', c.schedule_slots || '24/7'])),
  ...((d.campaigns_without_spend || []).length ? ['', `Campaigns with no spend in the period: ${d.campaigns_without_spend.map((c) => `${c.name} (${c.status})`).join(', ')}.`] : []),
  '',
  '## Conversion tracking',
  '',
  table(['Action', 'Type', 'Status', 'Primary', 'Counting', 'Call seconds', 'Last conversion'],
    conv.map((c) => [c.name, c.type, c.status, c.primary ? 'yes' : 'no', c.counting, c.call_seconds ?? '', c.last_conversion || 'never'])),
  '',
  '## Keywords',
  '',
  `${n(kw.count)} active keywords, average Quality Score ${kw.avg_quality_score ?? 'n/a'}, ${n(kw.low_quality)} below 5. By match type: ${Object.entries(kw.by_match_type || {}).map(([k, x]) => `${k.toLowerCase()} ${x}`).join(', ') || 'none'}.`,
  '',
  '## Search terms (last 90 days)',
  '',
  'Top terms by cost:',
  '',
  table(['Term', 'Cost', 'Clicks', 'Conv.', 'Already negative'], (d.search_terms_top || []).map((t) => [t.term, m(t.cost), t.clicks, t.conversions, t.negated ? 'yes' : 'no'])),
  '',
  'Terms with spend and no conversions (candidates for the negative list):',
  '',
  table(['Term', 'Cost', 'Clicks'], (d.search_terms_wasted || []).map((t) => [t.term, m(t.cost), t.clicks])),
  '',
  `Terms containing a person's name are not shown or stored (${n(d.search_terms_name_filtered && d.search_terms_name_filtered.rows)} daily rows, ${m(d.search_terms_name_filtered && d.search_terms_name_filtered.cost)}).`,
  '',
  '## Negative keywords',
  '',
  `Campaign level ${n(d.negatives && d.negatives.campaign_level)}, ad group level ${n(d.negatives && d.negatives.ad_group_level)}, shared lists ${n(d.negatives && d.negatives.shared_list_level)}.`,
  '',
  table(['Shared list', 'Keywords', 'Campaigns using it'], (d.shared_lists || []).map((l) => [l.name, l.members, l.campaigns])),
  '',
  '## Ads and assets',
  '',
  `${n(d.ads && d.ads.count)} enabled ads, ${n(d.ads && d.ads.disapproved)} disapproved, ${n(d.ads && d.ads.limited)} limited. Ad strength: ${Object.entries((d.ads && d.ads.by_strength) || {}).map(([k, x]) => `${k.toLowerCase()} ${x}`).join(', ') || 'n/a'}.`,
  `Assets: ${Object.entries(d.assets || {}).map(([k, x]) => `${k.toLowerCase()} ${x}`).join(', ') || 'none'}.`,
  '',
  '## Location',
  '',
  `Spend on people in the area: ${m(geo.presence_cost)}. Spend on people only interested in the area: ${m(geo.interest_cost)}.`,
  '',
  '## Open Google recommendations',
  '',
  ...((d.recommendations || []).length ? d.recommendations.map((r) => `- ${String(r.type).toLowerCase().replace(/_/g, ' ')}${n(r.est_extra_conversions) ? ` (est. +${r.est_extra_conversions} conversions)` : ''}`) : ['- None.']),
  '',
  '## Change history (last 30 days)',
  '',
  Object.entries(d.changes_30d || {}).map(([k, x]) => `- ${k.toLowerCase().replace(/_/g, ' ')}: ${x}`).join('\n') || '- No changes.',
  '',
].join('\n').replace(/[–—]/g, '-');

return [{
  json: {
    row: {
      client_id: v.client_id,
      customer_id: v.customer_id,
      period_from: period.from,
      period_to: period.to,
      summary: {
        cost: Math.round(totalCost * 100) / 100, currency: cur, clicks: totalClicks,
        conversions: Math.round(totalConv * 100) / 100, calls: n(calls.total), calls_90s: n(calls.over_90s),
        issues: issues.length, issues_high: issues.filter((i) => i.severity === 'high').length, issue_list: issues,
      },
      markdown: md,
      status: 'draft',
      created_by: user.user_id,
    },
  },
}];
