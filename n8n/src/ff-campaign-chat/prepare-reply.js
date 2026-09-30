// @include shared/ai.js
// AI Agent output -> the assistant row. A failed or malformed output (the
// agent has onError: continueRegularOutput) becomes a plain apology instead of
// an error, so the conversation still shows something.
const route = $('Route').first().json;
const item = $input.first().json || {};
const out = item.output;

let content = 'The assistant could not answer just now. Please try again in a moment.';
let action = null;
if (!item.error && out && typeof out.reply === 'string' && out.reply.trim()) {
  content = cleanText(out.reply).slice(0, 4000);
  action = normalizeAction(out.proposed_action);
}

return [{
  json: {
    customer_id: route.customer_id,
    campaign_id: route.campaign_id,
    role: 'assistant',
    content,
    proposed_action: action,
    action_status: action ? 'proposed' : null,
  },
}];
