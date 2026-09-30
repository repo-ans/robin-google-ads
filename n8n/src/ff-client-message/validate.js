// @include shared/names.js
// @include shared/ai.js
// @include shared/input.js
// Body: { client_id, body, campaign_row_id? }
// A client login may only post to its own client, and only about its own
// campaigns. Names in the text are replaced with [name] before storage
// (hard rule 4) - the portal also asks clients not to include them.
const b = requestBody();
const user = caller();
const campaign = $input.first().json || {};

if (!isUuid(b.client_id)) return reject(400, 'client_id is missing or not valid.');
if (user.role === 'client_viewer' && user.client_id !== b.client_id) {
  return reject(403, 'You can only send suggestions for your own account.');
}
const raw = text(b.body, 4000);
if (!raw) return reject(400, 'The message is empty.');

let customerIdValue = null;
let campaignIdValue = null;
let campaignName = null;
if (b.campaign_row_id !== undefined && b.campaign_row_id !== null && b.campaign_row_id !== '') {
  if (!isUuid(b.campaign_row_id)) return reject(400, 'campaign_row_id is not valid.');
  const owner = campaign.ad_accounts && campaign.ad_accounts.client_id;
  if (!campaign.customer_id || owner !== b.client_id) return reject(404, 'Campaign not found for this client.');
  customerIdValue = campaign.customer_id;
  campaignIdValue = campaign.campaign_id;
  campaignName = campaign.name;
}

const { redactNames } = makeNameFilters([campaignName || '']);
return [{
  json: {
    valid: true,
    row: {
      client_id: b.client_id,
      customer_id: customerIdValue,
      campaign_id: campaignIdValue,
      direction: 'inbound',
      body: cleanText(redactNames(raw)),
      status: 'new',
      author_id: user.user_id,
    },
  },
}];
