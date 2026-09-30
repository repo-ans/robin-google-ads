// Request bodies for the current client:
//   DataForSEO  keywords_data/google_ads/search_volume/live (up to 1000 keywords)
//   Google Ads  KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics (read only)
const t = $('Loop over clients').first().json;
const LANGUAGES = { en: 'languageConstants/1000', fr: 'languageConstants/1002', es: 'languageConstants/1003' };

const googleBody = {
  keywords: t.keywords,
  keywordPlanNetwork: 'GOOGLE_SEARCH',
  language: LANGUAGES[t.language_code] || LANGUAGES.en,
  historicalMetricsOptions: { includeAverageCpc: true },
};
if (t.geo_targets.length) googleBody.geoTargetConstants = t.geo_targets;

return [{
  json: {
    ...t,
    dataforseo_body: [{ keywords: t.keywords, location_code: t.location_code, language_code: t.language_code }],
    google_body: googleBody,
  },
}];
