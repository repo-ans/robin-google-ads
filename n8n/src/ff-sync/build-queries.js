// One item per GAQL query for the current account (PLAN.md section 6).
// "Google Ads search" runs once per item; "Map and plan writes" matches each
// response back to its query with itemMatching(), never by position.
//
// Windows (PLAN.md 5.2), in the account's own time zone, ending yesterday:
//   first sync      - 365 days campaign-level, 90 days detail
//   weekly / "full" - 90 days
//   daily           - 30 days
const cfg = $('Config').first().json;
const run = $('Start sync run').first().json;
const account = $('Loop over accounts').first().json;

const tz = account.time_zone || 'UTC';
function todayIn(zone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (e) {
    return new Date().toISOString().slice(0, 10);
  }
}
function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const today = todayIn(tz);
const to = addDays(today, -1);
const firstSync = !account.first_synced_at;
const detailDays = firstSync || cfg.mode === 'weekly' ? 90 : 30;
const campaignDays = firstSync ? 365 : detailDays;
const fromCampaign = addDays(today, -campaignDays);
const fromDetail = addDays(today, -detailDays);
// change_event only allows the last 30 days.
const fromChanges = addDays(today, firstSync ? -29 : -2);

const between = (from) => `segments.date BETWEEN '${from}' AND '${to}'`;

const Q = {
  customer: `SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone,
    customer.auto_tagging_enabled, customer.manager, customer.test_account,
    customer.call_reporting_setting.call_reporting_enabled,
    customer.call_reporting_setting.call_conversion_reporting_enabled,
    customer.call_reporting_setting.call_conversion_action,
    customer.conversion_tracking_setting.conversion_tracking_status,
    customer.conversion_tracking_setting.enhanced_conversions_for_leads_enabled
    FROM customer`,

  campaigns: `SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status,
    campaign.primary_status, campaign.primary_status_reasons,
    campaign.advertising_channel_type, campaign.advertising_channel_sub_type,
    campaign.bidding_strategy_type, campaign.target_cpa.target_cpa_micros,
    campaign.maximize_conversions.target_cpa_micros, campaign.target_roas.target_roas,
    campaign.maximize_conversion_value.target_roas,
    campaign.network_settings.target_google_search, campaign.network_settings.target_search_network,
    campaign.network_settings.target_content_network,
    campaign.geo_target_type_setting.positive_geo_target_type,
    campaign.geo_target_type_setting.negative_geo_target_type,
    campaign_budget.id, campaign_budget.amount_micros, campaign_budget.delivery_method,
    campaign_budget.explicitly_shared
    FROM campaign`,

  campaign_criteria: `SELECT campaign.id, campaign_criterion.criterion_id, campaign_criterion.type,
    campaign_criterion.negative, campaign_criterion.status, campaign_criterion.bid_modifier,
    campaign_criterion.location.geo_target_constant,
    campaign_criterion.proximity.radius, campaign_criterion.proximity.radius_units,
    campaign_criterion.language.language_constant,
    campaign_criterion.ad_schedule.day_of_week,
    campaign_criterion.ad_schedule.start_hour, campaign_criterion.ad_schedule.start_minute,
    campaign_criterion.ad_schedule.end_hour, campaign_criterion.ad_schedule.end_minute,
    campaign_criterion.device.type,
    campaign_criterion.keyword.text, campaign_criterion.keyword.match_type
    FROM campaign_criterion
    WHERE campaign_criterion.type IN ('LOCATION','PROXIMITY','LANGUAGE','AD_SCHEDULE','DEVICE','KEYWORD')
      AND campaign_criterion.status != 'REMOVED' AND campaign.status != 'REMOVED'`,

  ad_groups: `SELECT campaign.id, ad_group.id, ad_group.name, ad_group.status, ad_group.type,
    ad_group.cpc_bid_micros
    FROM ad_group WHERE ad_group.status != 'REMOVED'`,

  keywords: `SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.negative,
    ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
    ad_group_criterion.status, ad_group_criterion.system_serving_status,
    ad_group_criterion.approval_status, ad_group_criterion.cpc_bid_micros,
    ad_group_criterion.effective_cpc_bid_micros, ad_group_criterion.final_urls,
    ad_group_criterion.quality_info.quality_score,
    ad_group_criterion.quality_info.creative_quality_score,
    ad_group_criterion.quality_info.post_click_quality_score,
    ad_group_criterion.quality_info.search_predicted_ctr,
    ad_group_criterion.position_estimates.first_page_cpc_micros,
    ad_group_criterion.position_estimates.top_of_page_cpc_micros,
    ad_group_criterion.position_estimates.first_position_cpc_micros
    FROM ad_group_criterion
    WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.status != 'REMOVED'`,

  shared_sets: `SELECT shared_set.id, shared_set.name, shared_set.type, shared_set.status, shared_set.member_count
    FROM shared_set WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'`,

  shared_criteria: `SELECT shared_set.id, shared_criterion.criterion_id, shared_criterion.keyword.text,
    shared_criterion.keyword.match_type
    FROM shared_criterion
    WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'
      AND shared_criterion.type = 'KEYWORD'`,

  campaign_shared_sets: `SELECT campaign.id, shared_set.id, campaign_shared_set.status
    FROM campaign_shared_set
    WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND campaign_shared_set.status != 'REMOVED'`,

  ads: `SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status,
    ad_group_ad.ad_strength, ad_group_ad.ad.final_urls,
    ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions,
    ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2,
    ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status,
    ad_group_ad.policy_summary.policy_topic_entries
    FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'`,

  asset_labels: `SELECT campaign.id, ad_group.id, ad_group_ad_asset_view.ad_group_ad, asset.id,
    asset.text_asset.text, ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.performance_label,
    ad_group_ad_asset_view.pinned_field, ad_group_ad_asset_view.enabled,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM ad_group_ad_asset_view
    WHERE segments.date DURING LAST_30_DAYS
      AND ad_group_ad_asset_view.field_type IN ('HEADLINE','DESCRIPTION')`,

  assets_account: `SELECT customer_asset.field_type, customer_asset.status, customer_asset.primary_status,
    asset.id, asset.type, asset.name, asset.final_urls,
    asset.call_asset.phone_number, asset.call_asset.call_conversion_reporting_state,
    asset.call_asset.call_conversion_action,
    asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2,
    asset.callout_asset.callout_text,
    asset.structured_snippet_asset.header, asset.structured_snippet_asset.values
    FROM customer_asset
    WHERE customer_asset.field_type IN ('CALL','SITELINK','CALLOUT','STRUCTURED_SNIPPET')
      AND customer_asset.status != 'REMOVED'`,

  assets_campaign: `SELECT campaign.id, campaign_asset.field_type, campaign_asset.status, campaign_asset.primary_status,
    asset.id, asset.type, asset.name, asset.final_urls,
    asset.call_asset.phone_number, asset.call_asset.call_conversion_reporting_state,
    asset.call_asset.call_conversion_action,
    asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2,
    asset.callout_asset.callout_text,
    asset.structured_snippet_asset.header, asset.structured_snippet_asset.values
    FROM campaign_asset
    WHERE campaign_asset.field_type IN ('CALL','SITELINK','CALLOUT','STRUCTURED_SNIPPET')
      AND campaign_asset.status != 'REMOVED'`,

  assets_ad_group: `SELECT campaign.id, ad_group.id, ad_group_asset.field_type, ad_group_asset.status,
    ad_group_asset.primary_status,
    asset.id, asset.type, asset.name, asset.final_urls,
    asset.call_asset.phone_number, asset.call_asset.call_conversion_reporting_state,
    asset.call_asset.call_conversion_action,
    asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2,
    asset.callout_asset.callout_text,
    asset.structured_snippet_asset.header, asset.structured_snippet_asset.values
    FROM ad_group_asset
    WHERE ad_group_asset.field_type IN ('CALL','SITELINK','CALLOUT','STRUCTURED_SNIPPET')
      AND ad_group_asset.status != 'REMOVED'`,

  conversion_actions: `SELECT conversion_action.id, conversion_action.name, conversion_action.category,
    conversion_action.type, conversion_action.origin, conversion_action.status,
    conversion_action.counting_type, conversion_action.primary_for_goal,
    conversion_action.include_in_conversions_metric,
    conversion_action.value_settings.default_value, conversion_action.value_settings.always_use_default_value,
    conversion_action.click_through_lookback_window_days,
    conversion_action.phone_call_duration_seconds,
    conversion_action.attribution_model_settings.attribution_model
    FROM conversion_action WHERE conversion_action.status != 'REMOVED'`,

  recommendations: `SELECT recommendation.resource_name, recommendation.type, recommendation.campaign,
    recommendation.ad_group, recommendation.dismissed, recommendation.impact
    FROM recommendation`,

  change_events: `SELECT change_event.resource_name, change_event.change_date_time,
    change_event.change_resource_type, change_event.change_resource_name, change_event.client_type,
    change_event.user_email, change_event.resource_change_operation, change_event.changed_fields,
    change_event.campaign, change_event.ad_group
    FROM change_event
    WHERE change_event.change_date_time >= '${fromChanges} 00:00:00'
      AND change_event.change_date_time <= '${today} 23:59:59'
    ORDER BY change_event.change_date_time DESC
    LIMIT 10000`,

  campaign_daily: `SELECT campaign.id, segments.date,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value,
    metrics.all_conversions, metrics.all_conversions_value, metrics.view_through_conversions,
    metrics.phone_calls, metrics.phone_impressions,
    metrics.search_impression_share, metrics.search_budget_lost_impression_share,
    metrics.search_rank_lost_impression_share, metrics.search_top_impression_share,
    metrics.search_absolute_top_impression_share,
    metrics.top_impression_percentage, metrics.absolute_top_impression_percentage
    FROM campaign WHERE ${between(fromCampaign)}`,

  ad_group_daily: `SELECT campaign.id, ad_group.id, segments.date,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
    metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value,
    metrics.phone_calls
    FROM ad_group WHERE ${between(fromCampaign)}`,

  keyword_daily: `SELECT campaign.id, ad_group.id, ad_group_criterion.criterion_id, segments.date,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
    metrics.conversions_value, metrics.all_conversions, metrics.search_impression_share
    FROM keyword_view WHERE ${between(fromDetail)}`,

  search_terms: `SELECT campaign.id, ad_group.id, search_term_view.search_term, search_term_view.status,
    segments.keyword.ad_group_criterion, segments.keyword.info.text, segments.keyword.info.match_type,
    segments.search_term_match_type, segments.date,
    metrics.impressions, metrics.clicks, metrics.cost_micros,
    metrics.conversions, metrics.conversions_value, metrics.all_conversions
    FROM search_term_view WHERE ${between(fromDetail)}`,

  ad_daily: `SELECT campaign.id, ad_group.id, ad_group_ad.ad.id, segments.date,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
    FROM ad_group_ad WHERE ${between(fromDetail)}`,

  asset_daily: `SELECT campaign.id, asset.id, campaign_asset.field_type, segments.date,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM campaign_asset
    WHERE ${between(fromDetail)} AND campaign_asset.field_type IN ('CALL','SITELINK','CALLOUT')`,

  conversion_daily: `SELECT campaign.id, segments.conversion_action, segments.date,
    metrics.conversions, metrics.conversions_value, metrics.all_conversions, metrics.all_conversions_value
    FROM campaign WHERE ${between(fromCampaign)}`,

  hourly: `SELECT campaign.id, segments.date, segments.hour, segments.day_of_week,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.phone_calls
    FROM campaign WHERE ${between(fromDetail)}`,

  device: `SELECT campaign.id, segments.date, segments.device,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value
    FROM campaign WHERE ${between(fromDetail)}`,

  geo: `SELECT campaign.id, segments.date, geographic_view.location_type, geographic_view.country_criterion_id,
    segments.geo_target_most_specific_location,
    metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
    FROM geographic_view WHERE ${between(fromDetail)}`,

  // caller_area_code and caller_country_code are deliberately not selected (hard rule 4).
  calls: `SELECT call_view.resource_name, campaign.id, ad_group.id,
    call_view.start_call_date_time, call_view.end_call_date_time, call_view.call_duration_seconds,
    call_view.call_status, call_view.type, call_view.call_tracking_display_location
    FROM call_view
    WHERE call_view.start_call_date_time >= '${fromDetail} 00:00:00'
      AND call_view.start_call_date_time <= '${to} 23:59:59'`,
};

const passAt = new Date().toISOString();

return Object.entries(Q).map(([name, gaql]) => ({
  json: {
    query_name: name,
    gaql: gaql.replace(/\s+/g, ' ').trim(),
    customer_id: account.customer_id,
    login_customer_id: account.login_customer_id,
    time_zone: tz,
    sync_run_id: run.id,
    // Every row written in this pass carries this timestamp. Structure rows
    // older than it afterwards are soft-removed (removed_at), never deleted.
    pass_at: passAt,
    first_sync: firstSync,
    window: { from_campaign: fromCampaign, from_detail: fromDetail, to },
  },
}));
