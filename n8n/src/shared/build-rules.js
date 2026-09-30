// ---- shared/build-rules.js (included by scripts/build-n8n.mjs) -------------
// Rob's SOP rules for a campaign FF builds (needs shared/ai.js for cleanText):
//   - Search only; built PAUSED; location = presence only
//   - A: at-need, 24/7.  C: preplanning, office hours
//   - positive keywords PHRASE or EXACT only, 5-15 per ad group
//   - at most 2 responsive search ads per ad group
//   - copy: plain hyphens, no emoji (cleaned), Google's length limits
// checkDraft(d) -> { issues: [..plain sentences..], clean: {...} }
// A draft can be saved with issues; it can only be built with none.

const BUILD_TEMPLATES = ['A', 'C'];
const BIDDING = ['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CLICKS', 'MANUAL_CPC'];
const MATCH_TYPES = ['PHRASE', 'EXACT'];

function checkDraft(d) {
  const issues = [];
  const str = (v, max) => cleanText(typeof v === 'string' ? v : '').slice(0, max);

  const template = BUILD_TEMPLATES.includes(d.template) ? d.template : null;
  if (!template) issues.push('Pick campaign type A (at-need, 24/7) or C (preplanning, office hours).');
  const name = str(d.name, 120);
  if (name.length < 3) issues.push('Give the campaign a name.');
  const budget = Number(d.daily_budget);
  if (!(budget > 0 && budget <= 10000)) issues.push('Set a daily budget above 0.');
  const bidding = BIDDING.includes(d.bidding_strategy) ? d.bidding_strategy : 'MAXIMIZE_CONVERSIONS';

  const geo = (Array.isArray(d.geo_targets) ? d.geo_targets : [])
    .filter((g) => g && /^geoTargetConstants\/[0-9]+$/.test(g.resource_name || ''))
    .slice(0, 25)
    .map((g) => ({ resource_name: g.resource_name, name: str(g.name, 150) }));
  if (geo.length === 0) issues.push('Add at least one location (people in the area - presence only).');

  const groups = (Array.isArray(d.ad_groups) ? d.ad_groups : []).slice(0, 20).map((g, gi) => {
    const label = `Ad group ${gi + 1}`;
    const gname = str(g && g.name, 100);
    if (!gname) issues.push(`${label}: add a name.`);
    const finalUrl = typeof (g && g.final_url) === 'string' ? g.final_url.trim() : '';
    if (!/^https:\/\/[^\s]+\.[^\s]+$/.test(finalUrl)) issues.push(`${label}: the landing page must be a full https:// address.`);

    const seen = new Set();
    const keywords = (Array.isArray(g && g.keywords) ? g.keywords : [])
      .map((k) => ({ text: str(k && k.text, 80).toLowerCase().replace(/\s+/g, ' '), match_type: String((k && k.match_type) || '').toUpperCase() }))
      .filter((k) => k.text && !seen.has(`${k.text}|${k.match_type}`) && seen.add(`${k.text}|${k.match_type}`));
    if (keywords.length < 5 || keywords.length > 15) issues.push(`${label}: use 5 to 15 keywords (now ${keywords.length}).`);
    for (const k of keywords) {
      if (!MATCH_TYPES.includes(k.match_type)) issues.push(`${label}: "${k.text}" must be phrase or exact match.`);
      if (k.text.split(' ').length > 10) issues.push(`${label}: "${k.text}" has more than 10 words.`);
    }

    const ads = (Array.isArray(g && g.ads) ? g.ads : []).slice(0, 3).map((a, ai) => {
      const alabel = `${label}, ad ${ai + 1}`;
      const headlines = (Array.isArray(a && a.headlines) ? a.headlines : []).map((h) => str(h, 200)).filter(Boolean);
      const descriptions = (Array.isArray(a && a.descriptions) ? a.descriptions : []).map((h) => str(h, 300)).filter(Boolean);
      if (headlines.length < 3 || headlines.length > 15) issues.push(`${alabel}: use 3 to 15 headlines.`);
      if (descriptions.length < 2 || descriptions.length > 4) issues.push(`${alabel}: use 2 to 4 descriptions.`);
      headlines.forEach((h) => h.length > 30 && issues.push(`${alabel}: headline "${h}" is over 30 characters.`));
      descriptions.forEach((h) => h.length > 90 && issues.push(`${alabel}: a description is over 90 characters.`));
      const path1 = str(a && a.path1, 50).replace(/\s+/g, '-');
      const path2 = str(a && a.path2, 50).replace(/\s+/g, '-');
      if (path1.length > 15 || path2.length > 15) issues.push(`${alabel}: display paths are limited to 15 characters.`);
      return { headlines, descriptions, path1, path2 };
    });
    if (ads.length === 0) issues.push(`${label}: add at least one responsive search ad.`);
    if (ads.length > 2) issues.push(`${label}: at most 2 responsive search ads.`);

    return { name: gname, final_url: finalUrl, keywords, ads: ads.slice(0, 2) };
  });
  if (groups.length === 0) issues.push('Add at least one ad group.');

  return {
    issues,
    clean: {
      template,
      name,
      daily_budget_micros: budget > 0 ? Math.round(budget * 1e6) : 0,
      bidding_strategy: bidding,
      geo_targets: geo,
      ad_groups: groups,
    },
  };
}
// ---- end shared/build-rules.js ----------------------------------------------
