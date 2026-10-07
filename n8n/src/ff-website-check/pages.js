// One item per page to check: the client's website (Edit client) and the landing
// pages of its enabled ads (from ff_website_targets), at most 5 per client.
// Emits { none: true } when there is nothing to check.
const rows = $input.all().map((i) => i.json).filter((r) => r && r.client_id && Array.isArray(r.urls));
const out = [];
for (const r of rows) {
  const seen = new Set();
  for (const raw of r.urls) {
    const url = String(raw || '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(url) || url.length > 500 || seen.has(url)) continue;
    seen.add(url);
    out.push({ json: { client_id: r.client_id, process: r.process, url } });
    if (seen.size >= 5) break;
  }
}
return out.length ? out : [{ json: { none: true } }];
