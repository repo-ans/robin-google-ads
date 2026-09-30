// @include shared/ai.js
// AI Agent output -> campaign_chat_messages rows (is_proactive = true).
// Matched to its campaign with itemMatching(i); falls back to position only if
// the agent node did not keep the paired-item link. A malformed output
// ({ output: null }) or an error item from onError: continueRegularOutput is
// treated as "nothing to post" (reference lesson).
const inputs = $input.all();
const rows = [];

inputs.forEach((item, i) => {
  let ctx = null;
  try {
    ctx = $('Prepare suggestion inputs').itemMatching(i).json;
  } catch (e) {
    ctx = ($('Prepare suggestion inputs').all()[i] || {}).json || null;
  }
  const out = item.json && item.json.output;
  if (!ctx || item.json.error || !out || !out.should_post || !out.message) return;
  const action = normalizeAction(out.proposed_action);
  rows.push({
    customer_id: ctx.customer_id,
    campaign_id: ctx.campaign_id,
    role: 'assistant',
    content: cleanText(out.message).slice(0, 3000),
    proposed_action: action,
    action_status: action ? 'proposed' : null,
    is_proactive: true,
  });
});

return [{ json: { rows, count: rows.length } }];
