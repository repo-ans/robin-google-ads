// @include shared/input.js
// Turns a validated action into one Supabase write. For triage the stored
// search term text is copied from search_term_daily (already name-filtered).
const v = $('Validate input').first().json;
const term = $input.first().json || {};
const user = caller();

if (v.action === 'triage') {
  if (!term.search_term) return reject(404, 'Search term not found.');
  return [{
    json: {
      valid: true, method: 'POST', prefer: 'resolution=merge-duplicates,return=representation',
      path: 'search_term_triage?on_conflict=customer_id,campaign_id,term_hash',
      body: [{
        customer_id: v.customer_id, campaign_id: v.campaign_id, term_hash: v.term_hash, search_term: term.search_term,
        decision: v.decision, theme: v.theme, note: v.note, decided_by: user.user_id, decided_how: 'person', decided_at: new Date().toISOString(),
      }],
    },
  }];
}

const rn = encodeURIComponent(v.resource_name);
return [{
  json: {
    valid: true, method: 'PATCH', prefer: 'return=representation',
    path: v.action === 'hide_recommendation'
      ? `recommendations?resource_name=eq.${rn}&status=eq.open`
      : `recommendations?resource_name=eq.${rn}&status=eq.hidden`,
    body: { status: v.action === 'hide_recommendation' ? 'hidden' : 'open' },
  },
}];
