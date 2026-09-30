// One item per seed keyword for DataForSEO related keywords. Always at least one
// item ({ skip: true }) so the loop keeps going when a client has no seeds.
const cfg = $('Config').first().json;
const t = $('Build requests').first().json;
const seeds = t.seeds.slice(0, cfg.RELATED_SEEDS_PER_CLIENT);
if (!seeds.length) return [{ json: { skip: true, seed: null, body: [] } }];
return seeds.map((seed) => ({
  json: {
    skip: false,
    seed,
    body: [{ keyword: seed, location_code: t.location_code, language_code: t.language_code, limit: cfg.RELATED_PER_SEED }],
  },
}));
