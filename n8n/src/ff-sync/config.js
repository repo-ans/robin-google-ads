// Non-secret settings for ff-sync.
//   n8n credentials: FF Supabase (service role), FF OpenAI, FF Slack (optional).
//   Google Ads values (developer token, OAuth client, refresh token, MCC id) are
//   entered by Rob on the dashboard Settings page and read by "Get Google Ads secrets".
//
// This node also works out how the run was started:
//   - "Trigger: daily" / "Trigger: weekly" pass { ff_trigger, mode }
//   - the Sync Now webhook passes the request (headers + body)
// Webhook body (all optional): { customer_id: "1234567890", mode: "full" }
//   customer_id - sync just this account; anything not 10 digits is ignored
//   mode "full" - use the 90-day weekly window instead of 30 days
const SETTINGS = {
  SUPABASE_URL: 'https://SET-ME.supabase.co',
  SUPABASE_ANON_KEY: 'SET-ME', // public anon key, used only as apikey for GET /auth/v1/user
  GOOGLE_ADS_API_VERSION: 'v25', // one place to bump the API version
  ALLOWED_ROLES: ['rob_admin', 'ff_staff'], // who may press Sync Now
  SLACK_CHANNEL: '', // e.g. '#ff-ads'; leave empty for no Slack note
  AI_SUGGESTIONS: true, // proactive Campaign Assistant suggestions after each sync
};

const src = $input.first().json || {};
const fromWebhook = Boolean(src.headers);
const body = fromWebhook && src.body && typeof src.body === 'object' ? src.body : {};

let onlyCustomerId = null;
if (typeof body.customer_id === 'string' || typeof body.customer_id === 'number') {
  const digits = String(body.customer_id).replace(/-/g, '');
  if (/^[0-9]{10}$/.test(digits)) onlyCustomerId = digits;
}

let trigger = 'schedule';
let mode = 'daily';
if (fromWebhook) {
  trigger = 'manual';
  mode = body.mode === 'full' ? 'weekly' : 'daily';
} else if (src.ff_trigger === 'schedule_weekly') {
  trigger = 'schedule_weekly';
  mode = 'weekly';
}

return [
  {
    json: {
      ...SETTINGS,
      trigger,
      mode,
      only_customer_id: onlyCustomerId,
      started_at: new Date().toISOString(),
    },
  },
];
