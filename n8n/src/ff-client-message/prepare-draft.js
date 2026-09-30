// @include shared/ai.js
// AI draft -> message_drafts row. The draft is for FF staff to review and edit
// in the dashboard; the client never sees it until staff send a reply.
const msg = $('Save message').first().json;
const item = $input.first().json || {};
const out = item.output;

let draft = 'No draft could be written for this message. Please reply by hand.';
let action = null;
if (!item.error && out && typeof out.reply === 'string' && out.reply.trim()) {
  draft = cleanText(out.reply).slice(0, 4000);
  action = normalizeAction(out.proposed_action);
}

return [{
  json: {
    message_id: msg.id,
    draft_body: draft,
    proposed_action: action,
    action_status: action ? 'proposed' : null,
  },
}];
