// Monday Slack note to Rob: per client the three key numbers, tracking, what
// changed and what he needs to decide. Calm tone, plain hyphens, no emoji,
// no search terms and no personal data (weekly_stats holds counts only).
// On the first Monday of a month it adds last month's signed families, matches
// and cost per signed case (the number Rob cares about most).
const cfg = $('Config').first().json;
const rows = $('Get week rows').all().map((i) => i.json).filter((r) => r && r.client_id);
const monthRows = $input.all().map((i) => i.json).filter((r) => r && r.client_id);

if (!cfg.send_slack || !cfg.SLACK_CHANNEL) {
  return [{ json: { skip: true, reason: cfg.SLACK_CHANNEL ? 'not requested' : 'no SLACK_CHANNEL' } }];
}

const num = (v) => Number(v) || 0;
const money = (micros, cur) => `${(num(micros) / 1e6).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ${cur || ''}`.trim();
const count = (v) => String(Math.round(num(v) * 10) / 10);
const fmtDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const shown = rows
  .filter((r) => num(r.cost_micros) > 0 || (r.flags || []).length || (r.decisions || []).length)
  .sort((a, b) => num(b.cost_micros) - num(a.cost_micros));

const lines = [`FF Google Ads weekly report - ${fmtDay(cfg.week_start)} to ${fmtDay(cfg.week_end)}`];
if (!shown.length) lines.push('', 'No spend and nothing to look at this week.');

for (const r of shown.slice(0, 20)) {
  const c = r.clients || {};
  const numbers = c.process === 'online_cremation'
    ? `${count(r.arrangements)} paid arrangement(s) (${money(num(r.arrangements_value) * 1e6, r.currency_code)}), ${count(r.arrangements_started)} started`
    : `${count(r.calls_90s)} call(s) 90s+, ${count(r.forms)} form(s)`;
  lines.push('', `${c.name || 'Client'}: spent ${money(r.cost_micros, r.currency_code)}, ${numbers}. Tracking ${r.tracking_ok ? 'OK' : 'needs a look'}.`);
  for (const x of (r.changes || []).slice(0, 3)) lines.push(`- ${x}`);
  for (const x of (r.flags || []).slice(0, 4)) lines.push(`- Check: ${x}`);
  for (const x of r.decisions || []) lines.push(`- For you: ${x}`);
}
if (shown.length > 20) lines.push('', `And ${shown.length - 20} more client(s) on the dashboard.`);

// First Monday of the month (the Monday after this report's week is day 1-7).
const monday = new Date(`${cfg.week_end}T00:00:00Z`);
monday.setUTCDate(monday.getUTCDate() + 1);
if (monday.getUTCDate() <= 7 && monthRows.length) {
  const last = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth() - 1, 1));
  lines.push('', `${last.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} - signed families and cost per signed case:`);
  for (const m of monthRows.slice(0, 20)) {
    const per = num(m.signed_cases) > 0 ? `, ${money(num(m.spend_micros) / num(m.signed_cases), m.currency_code)} per signed case` : '';
    const what = num(m.signed_cases) > 0
      ? `${count(m.signed_cases)} signed (${count(m.matched)} matched to ads)${per}`
      : 'no case list uploaded yet';
    lines.push(`- ${m.client_name}: spent ${money(m.spend_micros, m.currency_code)}, ${what}.`);
  }
}
if (cfg.DASHBOARD_URL) lines.push('', `Dashboard: ${cfg.DASHBOARD_URL}`);

const text = lines.join('\n').replace(/[–—]/g, '-');
return [{ json: { skip: false, text } }];
