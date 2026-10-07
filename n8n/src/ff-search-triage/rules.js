// First pass, no AI: a search term that contains an FF blocked word (same
// matching as Google negatives: exact / phrase / all words), a competitor's name
// or the client's own name is "block" - obvious junk (Robin: "block obvious junk
// yourself"). Everything else goes to the AI in one batch per campaign.
// Output: one item { rule_rows, ai_batches } (counts only in logs, never terms).
const cfg = $('Config').first().json;
const campaigns = $('Get candidates').all().map((i) => i.json).filter((c) => c && c.customer_id && Array.isArray(c.terms));
const universal = $('Get blocked words').all().map((i) => i.json).filter((r) => r && r.text);

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 '&.-]+/g, ' ').replace(/\s+/g, ' ').trim();
function matches(term, neg, type) {
  const t = norm(term);
  const n = norm(neg);
  if (!n) return false;
  if (type === 'EXACT') return t === n;
  if (type === 'PHRASE') return ` ${t} `.includes(` ${n} `);
  const words = new Set(t.split(' '));
  return n.split(' ').every((w) => words.has(w));
}

const now = new Date().toISOString();
const ruleRows = [];
const aiBatches = [];
for (const c of campaigns) {
  const rest = [];
  for (const term of c.terms) {
    let theme = null;
    let why = null;
    const u = universal.find((x) => matches(term.term, x.text, x.match_type));
    if (u) { theme = u.theme; why = `FF blocked word "${u.text}"`; }
    if (!theme) {
      const comp = (c.competitor_terms || []).find((x) => matches(term.term, x, 'PHRASE'));
      if (comp) { theme = 'competitor'; why = 'competitor name'; }
    }
    if (!theme) {
      const own = ((c.own_brand_terms || []).length ? c.own_brand_terms : [c.client_name]).find((x) => matches(term.term, x, 'PHRASE'));
      if (own) { theme = 'own name'; why = "the client's own name"; }
    }
    if (theme) {
      ruleRows.push({
        customer_id: c.customer_id, campaign_id: c.campaign_id, term_hash: term.term_hash, search_term: term.term,
        decision: 'block', theme, note: `Sorted automatically: ${why}.`, decided_by: null, decided_how: 'rule', decided_at: now,
      });
    } else {
      rest.push(term);
    }
  }
  if (rest.length && cfg.USE_AI) {
    aiBatches.push({
      customer_id: c.customer_id, campaign_id: c.campaign_id, campaign_name: c.campaign_name || '', client_name: c.client_name || '',
      process: c.process === 'online_cremation' ? 'an online cremation provider' : 'a funeral home',
      towns: (c.towns || []).join(', ') || 'not set', terms: rest,
      list: rest.map((t, i) => `${i + 1}. ${t.term} (clicks ${t.clicks}, conversions ${Math.round(Number(t.conversions || 0) * 10) / 10})`).join('\n'),
    });
  } else if (rest.length) {
    for (const t of rest) {
      ruleRows.push({
        customer_id: c.customer_id, campaign_id: c.campaign_id, term_hash: t.term_hash, search_term: t.term,
        decision: 'ask_rob', theme: null, note: 'Not sorted automatically (AI is off).', decided_by: null, decided_how: 'rule', decided_at: now,
      });
    }
  }
}

return [{ json: { rule_rows: ruleRows, ai_batches: aiBatches, campaigns: campaigns.length } }];
