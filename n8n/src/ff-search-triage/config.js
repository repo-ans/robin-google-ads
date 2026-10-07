// Non-secret settings for ff-search-triage (PDF task 5, weekly part).
//   n8n credentials: FF Supabase (service role), FF OpenAI.
// Monday 07:30 (after the 06:00 sync) for the last 7 days, and from the dashboard
// ("Sort new searches"). Webhook body (optional): { client_id, days: 7..30 }
const SETTINGS = {
  SUPABASE_URL: 'https://SET-ME.supabase.co',
  SUPABASE_ANON_KEY: 'SET-ME',
  ALLOWED_ROLES: ['rob_admin', 'ff_staff'],
  USE_AI: true, // false: only the FF blocked words and names are used; the rest goes to Rob
};

const src = $input.first().json || {};
const fromWebhook = Boolean(src.headers);
const body = fromWebhook && src.body && typeof src.body === 'object' ? src.body : {};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const days = Number.isInteger(body.days) && body.days >= 1 && body.days <= 30 ? body.days : 7;

return [{
  json: {
    ...SETTINGS,
    body,
    trigger: fromWebhook ? 'manual' : 'schedule',
    only_client_id: typeof body.client_id === 'string' && uuid.test(body.client_id) ? body.client_id : null,
    days,
  },
}];
