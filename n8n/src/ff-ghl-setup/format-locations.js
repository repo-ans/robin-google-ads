// FF's GHL sub-accounts for the Edit client picker: business id, name and town
// only - nothing else from GHL leaves this node.
const res = $input.first().json || {};
if (!(res.statusCode >= 200 && res.statusCode < 300)) {
  const why = res.statusCode === 401 ? 'GHL refused the FF GHL key.'
    : res.statusCode === 403 ? 'The FF GHL key needs the locations read scope, and it must be an agency-level key.'
      : res.statusCode === 400 || res.statusCode === 422 ? 'Check GHL_COMPANY_ID in the ff-ghl-setup Config node.'
        : `GHL answered with status ${res.statusCode || 'none'}.`;
  return [{ json: { status: 502, body: { error: why } } }];
}
const locations = ((res.body && res.body.locations) || [])
  .filter((l) => l && l.id)
  .map((l) => ({ id: String(l.id), name: String(l.name || l.id), town: [l.city, l.state].filter(Boolean).join(', ') || null }))
  .sort((a, b) => a.name.localeCompare(b.name));
return [{ json: { status: 200, body: { ok: true, locations } } }];
