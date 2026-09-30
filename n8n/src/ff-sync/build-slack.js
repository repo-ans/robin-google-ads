// Slack note to Rob, only when something is flagged (PLAN.md 5.6).
// Calm tone, plain hyphens, no emoji, no search terms (ff_sync_alerts never
// returns search terms).
const cfg = $('Config').first().json;
const summary = $('Summarize run').first().json;
const alerts = $input.all().map((i) => i.json).filter((a) => a && a.kind);

if (alerts.length === 0 || !cfg.SLACK_CHANNEL) {
  return [{ json: { skip: true, alerts: alerts.length, slack_configured: Boolean(cfg.SLACK_CHANNEL) } }];
}

const fmtId = (id) => (id && id.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id || '');
const day = new Date().toISOString().slice(0, 10);
const how = cfg.trigger === 'manual' ? 'manual sync' : cfg.trigger === 'schedule_weekly' ? 'weekly sync' : 'daily sync';

const lines = [
  `FF ads ${how} - ${day}: ${summary.accounts_total} account(s), ${summary.accounts_failed} failed, ${summary.accounts_partial} partial.`,
  `${alerts.length} item(s) to look at:`,
];
for (const severity of ['high', 'medium']) {
  const group = alerts.filter((a) => a.severity === severity);
  if (group.length === 0) continue;
  lines.push('', severity === 'high' ? 'Needs attention' : 'Worth a look');
  for (const a of group.slice(0, 25)) {
    lines.push(`- ${a.account_name} (${fmtId(a.customer_id)}): ${a.detail}`);
  }
  if (group.length > 25) lines.push(`- and ${group.length - 25} more on the dashboard`);
}

// Keep it plain: no emoji, straight hyphens only.
const text = lines.join('\n').replace(/[–—]/g, '-');

return [{ json: { skip: false, text } }];
