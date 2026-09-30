// ---- shared/ai.js (included by scripts/build-n8n.mjs) ----------------------
// Checks and cleans what the AI returns before it is stored.

const ACTION_TYPES = ['update_daily_budget', 'pause_campaign', 'resume_campaign'];

// Hard rule 6: calm tone, plain hyphens, no emoji.
function cleanText(text) {
  return String(text || '')
    .replace(/[‒-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// Only the three reference action types survive; anything else becomes null.
// daily_budget is in the account currency.
function normalizeAction(a) {
  if (!a || typeof a !== 'object' || !ACTION_TYPES.includes(a.action_type)) return null;
  const out = { action_type: a.action_type, daily_budget: null, reason: cleanText(a.reason || '').slice(0, 300) };
  if (a.action_type === 'update_daily_budget') {
    const n = Number(a.daily_budget);
    if (!(n > 0 && n < 100000)) return null;
    out.daily_budget = Math.round(n * 100) / 100;
  }
  return out;
}

const money = (micros) => Math.round(Number(micros || 0) / 1e4) / 100;
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(Number(v) * 100)}%`);
// ---- end shared/ai.js -------------------------------------------------------
