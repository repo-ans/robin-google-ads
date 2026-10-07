// First business day of the month (Monday to Friday, workflow time zone), daily
// scheduled sync only: a short Slack note to Rob that last month's case lists
// are due, so the case match can run. Client business names only.
const cfg = $('Config').first().json;
const clients = $input.all().map((i) => i.json && i.json.name).filter(Boolean);
const now = new Date();
const day = now.getDate();
const weekday = (d) => new Date(now.getFullYear(), now.getMonth(), d).getDay();
const isWeekday = (d) => weekday(d) >= 1 && weekday(d) <= 5;
let first = 1;
while (!isWeekday(first)) first++;

if (cfg.trigger !== 'schedule' || !cfg.SLACK_CHANNEL || day !== first || clients.length === 0) {
  return [{ json: { skip: true } }];
}
const last = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
const text = [
  `Case lists for ${last} are due today from ${clients.length} client(s).`,
  'Each list: case date, case type, phone, email and first call time - no names.',
  'Run the case match on the dashboard (client > Case match) or with /ff-case-match, then delete the files.',
  '',
  ...clients.slice(0, 40).map((n) => `- ${n}`),
  ...(clients.length > 40 ? [`- and ${clients.length - 40} more`] : []),
].join('\n');
return [{ json: { skip: false, text } }];
