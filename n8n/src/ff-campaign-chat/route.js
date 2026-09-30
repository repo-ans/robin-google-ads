// @include shared/names.js
// @include shared/ai.js
// @include shared/input.js
// Decides what to do once the campaign is known. Output route:
//   send    - run the assistant
//   write   - one Supabase write (reset / delete a message / dismiss an action)
//   respond - answer straight away (campaign not found)
const v = $('Validate input').first().json;
const c = $input.first().json || {};
if (!c.customer_id) return [{ json: { route: 'respond', status: 404, body: { error: 'Campaign not found.' } } }];

const base = `campaign_chat_messages?customer_id=eq.${c.customer_id}&campaign_id=eq.${c.campaign_id}`;

if (v.action === 'send') {
  // Staff may type a family name by habit; it never reaches the table or the prompt.
  const { redactNames } = makeNameFilters([c.name || '']);
  return [{
    json: {
      route: 'send',
      customer_id: c.customer_id,
      campaign_id: c.campaign_id,
      content: cleanText(redactNames(v.message)).slice(0, 4000),
      author_id: caller().user_id,
    },
  }];
}

const writes = {
  reset: { method: 'DELETE', path: base, body: {} },
  delete_message: { method: 'DELETE', path: `${base}&id=eq.${v.message_id}`, body: {} },
  dismiss_action: {
    method: 'PATCH',
    path: `${base}&id=eq.${v.message_id}&action_status=eq.proposed`,
    body: { action_status: 'dismissed' },
  },
};
return [{ json: { route: 'write', prefer: 'return=minimal', ...writes[v.action] } }];
