// Non-secret settings for ff-dataforseo. n8n credentials: FF Supabase (service
// role) and FF DataForSEO (Basic Auth: API login + password). Google Ads values
// come from the dashboard Settings page ("Get Google Ads secrets").
// Weekly (Monday 05:00) and from the dashboard ("Refresh keyword data").
// Webhook body (optional): { client_id } to research one client only.
const SETTINGS = {
  SUPABASE_URL: 'https://SET-ME.supabase.co',
  SUPABASE_ANON_KEY: 'SET-ME',
  GOOGLE_ADS_API_VERSION: 'v25',
  ALLOWED_ROLES: ['rob_admin', 'ff_staff'],
  RELATED_SEEDS_PER_CLIENT: 5, // DataForSEO related-keywords calls per client per run
  RELATED_PER_SEED: 20,
};

const src = $input.first().json || {};
const fromWebhook = Boolean(src.headers);
const body = fromWebhook && src.body && typeof src.body === 'object' ? src.body : {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

return [{
  json: {
    ...SETTINGS,
    body,
    trigger: fromWebhook ? 'manual' : 'schedule',
    only_client_id: typeof body.client_id === 'string' && uuid.test(body.client_id) ? body.client_id : null,
  },
}];
