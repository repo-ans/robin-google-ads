// Non-secret settings for ff-sync. Every secret lives in an n8n credential:
//   FF Supabase (service role)       - Supabase node/HTTP credential
//   FF Google OAuth refresh          - Custom Auth: client id/secret + refresh token
//   FF Google Ads developer token    - Custom Auth: developer-token header
//   FF OpenAI                        - AI suggestions
//   FF Slack                         - Slack note (bot token)
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
  MCC_ID: 'SET-ME', // FF manager account, 10 digits, no dashes
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

const mcc = String(SETTINGS.MCC_ID).replace(/-/g, '');

return [
  {
    json: {
      ...SETTINGS,
      MCC_ID: /^[0-9]{10}$/.test(mcc) ? mcc : '',
      trigger,
      mode,
      only_customer_id: onlyCustomerId,
      started_at: new Date().toISOString(),
    },
  },
];
