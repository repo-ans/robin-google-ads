import { supabase } from "./supabaseClient";
import { callN8n } from "./n8n";

// ----------------------------------------------------------------- reads (Supabase + RLS)
// Dashboard read functions run as the signed-in user, so RLS applies.
export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

export type Client = {
  id: string;
  name: string;
  slug: string;
  website_url: string | null;
  phone: string | null;
  towns: string[];
  service_area_notes: string | null;
  process: "funeral_home" | "online_cremation";
  case_value_micros: number | null;
  currency_code: string | null;
  ghl_location_id: string | null;
  competitor_terms: string[];
  own_brand_terms: string[];
  slack_channel: string | null;
  writes_enabled: boolean;
  archived_at: string | null;
  dataforseo_location_code: number;
  language_code: string;
  office_hours: { days: string[]; start_hour: number; end_hour: number };
};

export type AdAccount = {
  customer_id: string;
  client_id: string | null;
  login_customer_id: string | null;
  descriptive_name: string | null;
  currency_code: string | null;
  time_zone: string | null;
  status: string | null;
  is_test_account: boolean;
  sync_enabled: boolean;
  last_synced_at: string | null;
  first_synced_at: string | null;
};

export type ClientTotals = {
  client_id: string;
  accounts: number;
  campaigns: number;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversions_value: number;
  phone_calls: number;
  calls_90s: number;
  currency_code: string | null;
};

export type CampaignTotals = {
  id: string;
  customer_id: string;
  campaign_id: string;
  name: string;
  status: string | null;
  channel_type: string | null;
  bidding_strategy_type: string | null;
  budget_micros: number | null;
  currency_code: string | null;
  removed_at: string | null;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversions_value: number;
  all_conversions: number;
  phone_calls: number;
  search_impression_share: number | null;
  calls_90s: number;
};

export type CampaignRow = {
  id: string;
  customer_id: string;
  campaign_id: string;
  name: string;
  status: string | null;
  serving_status: string | null;
  primary_status: string | null;
  channel_type: string | null;
  bidding_strategy_type: string | null;
  budget_micros: number | null;
  budget_shared: boolean | null;
  positive_geo_target_type: string | null;
  removed_at: string | null;
  synced_at: string;
};

export type DailyRow = {
  date: string;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversions_value: number;
  phone_calls: number;
  search_impression_share: number | null;
  search_budget_lost_is: number | null;
  search_rank_lost_is: number | null;
};

export type KeywordRow = {
  ad_group_id: string;
  ad_group_name: string | null;
  criterion_id: string;
  text: string;
  match_type: string | null;
  status: string | null;
  quality_score: number | null;
  qs_creative: string | null;
  qs_landing_page: string | null;
  qs_expected_ctr: string | null;
  first_page_cpc_micros: number | null;
  top_of_page_cpc_micros: number | null;
  removed_at: string | null;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversions_value: number;
  google_volume: number | null;
  dfs_volume: number | null;
  dfs_cpc_micros: number | null;
  dfs_competition: string | null;
};

export type SearchTermRow = {
  term_hash: string;
  search_term: string;
  name_filtered: boolean;
  ad_group_id: string;
  ad_group_name: string | null;
  keyword_text: string | null;
  keyword_match_type: string | null;
  search_term_match_type: string | null;
  status: string | null;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  conversions_value: number;
  is_negated: boolean;
  decision: "keep" | "block" | "ask_rob" | null;
  theme: string | null;
};

export type NegativeRow = {
  customer_id: string;
  campaign_id: string;
  ad_group_id: string | null;
  level: string;
  list_name: string | null;
  criterion_id: string;
  text: string;
  match_type: string | null;
};

export type AdRow = {
  ad_group_id: string;
  ad_group_name: string | null;
  ad_id: string;
  type: string | null;
  status: string | null;
  ad_strength: string | null;
  final_urls: string[];
  path1: string | null;
  path2: string | null;
  headlines: { text: string; pinned_field: string | null }[];
  descriptions: { text: string; pinned_field: string | null }[];
  approval_status: string | null;
  review_status: string | null;
  policy_topics: { topic: string | null; type: string | null }[];
  removed_at: string | null;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
};

export type AssetLabel = {
  ad_group_id: string;
  ad_id: string;
  asset_id: string;
  field_type: string;
  text: string | null;
  performance_label: string | null;
  pinned_field: string | null;
  enabled: boolean | null;
  impressions_30d: number;
  clicks_30d: number;
};

export type AssetRow = {
  level: string;
  asset_id: string;
  field_type: string;
  type: string | null;
  status: string | null;
  primary_status: string | null;
  text: string | null;
  description1: string | null;
  description2: string | null;
  final_url: string | null;
  phone_number: string | null;
  call_conversion_reporting_state: string | null;
  removed_at: string | null;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
};

export type HourlyRow = { day_of_week: string; hour: number; impressions: number; clicks: number; cost_micros: number; conversions: number; phone_calls: number };
export type DeviceRow = { device: string; impressions: number; clicks: number; cost_micros: number; conversions: number; conversions_value: number };
export type GeoRow = { location_type: string; geo_target_constant: string; name: string | null; canonical_name: string | null; impressions: number; clicks: number; cost_micros: number; conversions: number };

export type ConversionRow = {
  conversion_action_id: string;
  name: string;
  category: string | null;
  type: string | null;
  status: string | null;
  counting_type: string | null;
  primary_for_goal: boolean | null;
  phone_call_duration_seconds: number | null;
  last_conversion_date: string | null;
  flag_no_recent_conversions: boolean;
  flag_call_duration_not_90s: boolean;
  conversions: number;
  conversions_value: number;
  all_conversions: number;
};

export type AccountHealth = {
  customer_id: string;
  client_id: string | null;
  descriptive_name: string | null;
  auto_tagging_enabled: boolean | null;
  call_reporting_enabled: boolean | null;
  call_conversion_reporting_enabled: boolean | null;
  conversion_tracking_status: string | null;
  last_synced_at: string | null;
  flag_auto_tagging_off: boolean;
  flag_call_reporting_off: boolean;
  campaigns_not_presence_only: number;
  actions_no_recent_conversions: number;
};

export type Recommendation = {
  resource_name: string;
  type: string;
  status: "open" | "expired" | "hidden";
  est_extra_clicks: number;
  est_extra_conversions: number;
  est_cost_change_micros: number;
  last_seen_at: string;
};

export type ChangeEvent = {
  resource_name: string;
  changed_at: string;
  resource_type: string | null;
  operation: string | null;
  client_type: string | null;
  user_email: string | null;
  changed_fields: string[];
};

export type ProposedAction = {
  action_type: "update_daily_budget" | "pause_campaign" | "resume_campaign";
  daily_budget: number | null;
  reason: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposed_action: ProposedAction | null;
  action_status: "proposed" | "applied" | "dismissed" | null;
  is_proactive: boolean;
  created_at: string;
};

export type ClientMessage = {
  id: string;
  client_id: string;
  customer_id: string | null;
  campaign_id: string | null;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  created_at: string;
};

export type MessageDraft = {
  message_id: string;
  draft_body: string;
  proposed_action: ProposedAction | null;
  action_status: "proposed" | "applied" | "dismissed" | null;
};

export type Audit = {
  id: string;
  client_id: string;
  customer_id: string;
  period_from: string;
  period_to: string;
  summary: { cost?: number; currency?: string; issues?: number; issues_high?: number };
  markdown: string;
  status: "draft" | "reviewed_by_rob";
  created_at: string;
  reviewed_at: string | null;
};

export type BuildAdGroup = {
  name: string;
  final_url: string;
  keywords: { text: string; match_type: "PHRASE" | "EXACT" }[];
  ads: { headlines: string[]; descriptions: string[]; path1: string; path2: string }[];
};

export type CampaignBuild = {
  id: string;
  client_id: string;
  customer_id: string;
  template: "A" | "C";
  name: string;
  daily_budget_micros: number;
  bidding_strategy: "MAXIMIZE_CONVERSIONS" | "MAXIMIZE_CLICKS" | "MANUAL_CPC";
  geo_targets: { resource_name: string; name: string }[];
  ad_groups: BuildAdGroup[];
  status: "draft" | "building" | "built" | "error";
  resources: Record<string, unknown>;
  error: string | null;
  created_at: string;
  updated_at: string;
  built_at: string | null;
};

export type ProfileRow = {
  user_id: string;
  email: string;
  role: "rob_admin" | "ff_staff" | "client_viewer";
  client_id: string | null;
  disabled: boolean;
  created_at: string;
};

// ----------------------------------------------------------------- actions (n8n webhooks)
type Ok<T = unknown> = { ok: true; message?: string; data?: T };

export const actions = {
  syncNow: (customer_id?: string) => callN8n("ff/sync-now", customer_id ? { customer_id } : {}),
  keywordResearch: (client_id?: string) => callN8n("ff/keyword-research", client_id ? { client_id } : {}),

  chat: (body: { campaign_row_id: string; action: "send" | "reset" | "delete_message" | "dismiss_action"; message?: string; message_id?: string }) =>
    callN8n<{ message?: ChatMessage; ok?: boolean }>("ff/campaign-chat", body),
  applyAction: (source: "chat" | "message", source_id: string) =>
    callN8n<{ ok: true; applied: ProposedAction }>("ff/apply-campaign-action", { source, source_id }),

  postMessage: (body: { client_id: string; body: string; campaign_row_id?: string | null }) =>
    callN8n<{ ok: true; id: string }>("ff/client-message", body),
  sendReply: (message_id: string, reply_body: string) => callN8n<{ ok: true }>("ff/send-reply", { message_id, reply_body }),

  clientAdmin: <T = unknown>(body: Record<string, unknown>) => callN8n<Ok<T>>("ff/client-admin", body),
  review: (body: Record<string, unknown>) => callN8n<{ ok: true }>("ff/review-actions", body),

  audit: (body: { action: "generate"; client_id: string; customer_id: string } | { action: "review"; audit_id: string }) =>
    callN8n<{ ok: true; id?: string }>("ff/audit", body),

  geoSuggest: (query: string, country?: string) =>
    callN8n<{ suggestions: { resource_name: string; name: string; canonical_name: string; country_code: string | null; target_type: string | null }[] }>(
      "ff/geo-target-suggest", { query, country }),
  build: <T = unknown>(body: Record<string, unknown>) => callN8n<T>("ff/build-campaign", body),
  deleteCampaign: (campaign_row_id: string) => callN8n<{ ok: true }>("ff/delete-campaign", { campaign_row_id }),
};
