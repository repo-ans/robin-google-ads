// @include shared/input.js
// Body: { campaign_row_id, action: send | reset | delete_message | dismiss_action,
//         message? (send), message_id? (delete_message, dismiss_action) }
const b = requestBody();
const ACTIONS = ['send', 'reset', 'delete_message', 'dismiss_action'];

if (!isUuid(b.campaign_row_id)) return reject(400, 'campaign_row_id is missing or not valid.');
if (!ACTIONS.includes(b.action)) return reject(400, `action must be one of: ${ACTIONS.join(', ')}.`);
const message = text(b.message, 4000);
if (b.action === 'send' && !message) return reject(400, 'The message is empty.');
if ((b.action === 'delete_message' || b.action === 'dismiss_action') && !isUuid(b.message_id)) {
  return reject(400, 'message_id is missing or not valid.');
}

return [{
  json: {
    valid: true,
    action: b.action,
    campaign_row_id: b.campaign_row_id,
    message,
    message_id: isUuid(b.message_id) ? b.message_id : null,
  },
}];
