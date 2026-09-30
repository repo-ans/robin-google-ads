// @include shared/names.js
// @include shared/ai.js
// @include shared/input.js
// Body: { message_id, reply_body }. FF staff approve (and usually edit) the AI
// draft; the reply becomes a new outbound row the client sees in the dashboard.
// A proposed campaign change in the draft is NOT applied here - Rob applies it
// with Confirm & Apply (ff-apply-campaign-action, source "message").
const b = requestBody();
const m = $input.first().json || {};

if (!isUuid(b.message_id)) return reject(400, 'message_id is missing or not valid.');
if (!m.id) return reject(404, 'Message not found.');
if (m.direction !== 'inbound') return reject(400, 'Only a client message can be replied to.');
const body = text(b.reply_body, 4000);
if (!body) return reject(400, 'The reply is empty.');

const { redactNames } = makeNameFilters([]);
return [{
  json: {
    valid: true,
    row: {
      client_id: m.client_id,
      customer_id: m.customer_id,
      campaign_id: m.campaign_id,
      direction: 'outbound',
      body: cleanText(redactNames(body)),
      status: 'answered',
      author_id: caller().user_id,
    },
    inbound_id: m.id,
  },
}];
