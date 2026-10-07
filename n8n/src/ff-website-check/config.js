// Non-secret settings for ff-website-check. n8n credential: FF Supabase (service role).
// Daily 06:45 for every client (after the sync), and when a client is saved on the dashboard.
// Webhook body (optional): { client_id }
// Reads public pages only - no login to any website, nothing personal is kept.
const SETTINGS = {
  SUPABASE_URL: 'https://SET-ME.supabase.co',
  SUPABASE_ANON_KEY: 'SET-ME',
  ALLOWED_ROLES: ['rob_admin', 'ff_staff'],
  GHL_COMPANY_ID: 'SET-ME', // only a fallback - the agency id is read from a client already linked to GHL
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
