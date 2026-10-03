// Non-secret settings for ff-weekly-report (PDF task 8).
//   n8n credentials: FF Supabase (service role), FF GHL (Header Auth, agency-level key, optional),
//   FF Google Sheets (optional), FF Slack (optional).
// Monday 08:00 (after the 06:00 sync) for last week, Monday to Sunday.
// Webhook body (all optional): { client_id, week_start: "YYYY-MM-DD" (a Monday), slack: true }
//   A dashboard run never posts to Slack unless slack is true.
const SETTINGS = {
  SUPABASE_URL: 'https://SET-ME.supabase.co',
  SUPABASE_ANON_KEY: 'SET-ME',
  ALLOWED_ROLES: ['rob_admin', 'ff_staff'],
  SLACK_CHANNEL: '', // Rob's channel, e.g. '#ff-ads'; leave empty for no Slack note
  GHL_COMPANY_ID: 'SET-ME', // FF's GHL agency (company) id - same value as in ff-ghl-setup
  GHL_GOOGLE_ADS_TAG: 'from google ads', // the tag the GHL workflow adds to Google Ads leads
  SHEET_TAB: 'Weekly', // tab name in each client's Google Sheet (first row = column names)
  DASHBOARD_URL: '', // e.g. 'https://ff-ads.netlify.app' - linked at the end of the Slack note
};

const src = $input.first().json || {};
const fromWebhook = Boolean(src.headers);
const body = fromWebhook && src.body && typeof src.body === 'object' ? src.body : {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const day = (d) => d.toISOString().slice(0, 10);

// Last full week: the Monday before this week's Monday.
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const thisMonday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86400000);
let weekStart = day(new Date(thisMonday.getTime() - 7 * 86400000));
if (typeof body.week_start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.week_start)) {
  const d = new Date(`${body.week_start}T00:00:00Z`);
  if (!Number.isNaN(d.getTime()) && d.getUTCDay() === 1 && d <= today) weekStart = body.week_start;
}
const weekEnd = day(new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 6 * 86400000));

return [{
  json: {
    ...SETTINGS,
    body,
    trigger: fromWebhook ? 'manual' : 'schedule',
    only_client_id: typeof body.client_id === 'string' && uuid.test(body.client_id) ? body.client_id : null,
    send_slack: fromWebhook ? body.slack === true : true,
    week_start: weekStart,
    week_end: weekEnd,
  },
}];
