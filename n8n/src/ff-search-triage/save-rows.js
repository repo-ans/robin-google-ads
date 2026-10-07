// @include shared/ai.js
// Joins the rule decisions with the AI decisions (each AI answer matched to its
// campaign batch with itemMatching(i), each decision to its term by its number in
// that batch). A missing, malformed or unsure answer becomes "ask_rob" - nothing
// is ever blocked by a guess. Output: { rows, counts } for one upsert that never
// overwrites a decision already made (resolution=ignore-duplicates).
const rules = $('Rule triage').first().json;
const rows = [...(rules.rule_rows || [])];
const now = new Date().toISOString();
const DECISIONS = ['keep', 'block', 'ask_rob'];

let answers = [];
try {
  answers = $('Sort (AI Agent)').all();
} catch (e) {
  answers = []; // no AI batch this week
}
answers.forEach((item, i) => {
  let batch = null;
  try {
    batch = $('AI batches').itemMatching(i).json;
  } catch (e) {
    batch = (($('AI batches').all()[i]) || {}).json || null;
  }
  if (!batch || !batch.terms) return;
  const out = item.json && item.json.output;
  const byNumber = new Map();
  for (const d of (out && Array.isArray(out.decisions) ? out.decisions : [])) {
    const n = Number(d && d.n);
    if (Number.isInteger(n) && n >= 1 && n <= batch.terms.length && DECISIONS.includes(d.decision)) byNumber.set(n, d);
  }
  batch.terms.forEach((t, k) => {
    const d = byNumber.get(k + 1);
    rows.push({
      customer_id: batch.customer_id, campaign_id: batch.campaign_id, term_hash: t.term_hash, search_term: t.term,
      decision: d ? d.decision : 'ask_rob',
      theme: d && d.theme ? cleanText(d.theme).slice(0, 60) : null,
      note: d ? 'Sorted automatically by the AI.' : 'The AI gave no clear answer - Rob decides.',
      decided_by: null, decided_how: 'ai', decided_at: now,
    });
  });
});

const counts = { keep: 0, block: 0, ask_rob: 0 };
for (const r of rows) counts[r.decision]++;
return [{ json: { rows, counts, campaigns: rules.campaigns, total: rows.length } }];
