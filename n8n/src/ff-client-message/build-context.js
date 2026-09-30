// ff_message_context -> prompt text (reference "Build AI context" for the
// client portal). Picks the campaign the client chose; otherwise lists the
// client's campaigns so the draft does not guess (reference lesson).
const ctx = $input.first().json || {};
const msg = $('Save message').first().json;
const campaign = ctx.campaign;
let campaignText;
if (campaign && campaign.campaign) {
  const c = campaign.campaign;
  const p = campaign.last_30_days || {};
  const calls = campaign.calls_30d || {};
  const cur = c.currency || '';
  campaignText = `The client asked about campaign "${c.name}" (status ${c.status}, daily budget ${c.daily_budget} ${cur}). ` +
    `Last 30 days: cost ${p.cost ?? 0} ${cur}, ${p.clicks ?? 0} clicks, ${p.conversions ?? 0} conversions, ` +
    `${calls.total ?? 0} calls (${calls.over_90s ?? 0} of 90 seconds or more). Open Google recommendations: ` +
    `${(campaign.recommendations || []).map((r) => r.type).join(', ') || 'none'}.`;
} else {
  const list = (ctx.campaigns || []).map((c) => `"${c.name}" (${c.status}, daily budget ${c.daily_budget})`);
  campaignText = `The client did not pick a campaign. Their campaigns: ${list.join('; ') || 'none yet'}.`;
}

return [{ json: { clientName: ctx.client || 'the client', campaignText, clientMessage: msg.body } }];
