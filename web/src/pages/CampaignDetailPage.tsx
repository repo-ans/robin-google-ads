import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import type { CampaignRow, DailyRow } from "../lib/api";
import { useAuth } from "../lib/auth";
import { isAgency } from "../lib/types";
import { useDateRange } from "../lib/dateRange";
import { useAsync } from "../lib/useAsync";
import { avgCpcMicros, costPerConvMicros, ctr, customerId as fmtId, dateTime, dec, enumLabel, int, moneyMicros, pct } from "../lib/format";
import AppHeader from "../components/AppHeader";
import DateRangePicker from "../components/DateRangePicker";
import CampaignChat from "../components/CampaignChat";
import MessageThread from "../components/MessageThread";
import { ErrorNote, Loading, StatCard, StatusPill, Tabs } from "../components/ui";
import PerformanceTab from "../components/campaign/PerformanceTab";
import KeywordsTab from "../components/campaign/KeywordsTab";
import SearchTermsTab from "../components/campaign/SearchTermsTab";
import NegativesTab from "../components/campaign/NegativesTab";
import AdsAssetsTab from "../components/campaign/AdsAssetsTab";
import TimeDeviceTab from "../components/campaign/TimeDeviceTab";
import ConversionsTab from "../components/campaign/ConversionsTab";
import RecommendationsTab from "../components/campaign/RecommendationsTab";
import ChangeHistoryTab from "../components/campaign/ChangeHistoryTab";
import type { TabProps } from "../components/campaign/types";

type Tab = "assistant" | "performance" | "keywords" | "search_terms" | "negatives" | "ads" | "time" | "conversions" | "recommendations" | "suggestions" | "changes";

// Campaign detail (reference layout: KPI cards + tabs). Clients see the same
// analytics without the assistant, change history or any action buttons.
export default function CampaignDetailPage() {
  const { clientId = "", campaignId: campaignRowId = "" } = useParams<{ clientId: string; campaignId: string }>();
  const { profile } = useAuth();
  const agency = isAgency(profile?.role);
  const range = useDateRange();
  const [params, setParams] = useSearchParams();
  const [openRecs, setOpenRecs] = useState<number | null>(null);

  const { data, error, loading } = useAsync(async () => {
    const { data: c, error: e } = await supabase
      .from("campaigns")
      .select("id, customer_id, campaign_id, name, status, serving_status, primary_status, channel_type, bidding_strategy_type, budget_micros, budget_shared, positive_geo_target_type, removed_at, synced_at")
      .eq("id", campaignRowId)
      .maybeSingle();
    if (e) throw new Error(e.message);
    if (!c) throw new Error("Campaign not found.");
    const campaign = c as CampaignRow;
    const [acct, client, daily, recs] = await Promise.all([
      supabase.from("ad_accounts").select("currency_code, client_id").eq("customer_id", campaign.customer_id).maybeSingle(),
      supabase.from("clients").select("name, slug").eq("id", clientId).maybeSingle(),
      supabase.from("campaign_daily")
        .select("date, impressions, clicks, cost_micros, conversions, conversions_value, phone_calls, search_impression_share, search_budget_lost_is, search_rank_lost_is")
        .eq("customer_id", campaign.customer_id).eq("campaign_id", campaign.campaign_id)
        .gte("date", range.from).lte("date", range.to).order("date"),
      supabase.from("recommendations").select("resource_name", { count: "exact", head: true })
        .eq("customer_id", campaign.customer_id).eq("campaign_id", campaign.campaign_id).eq("status", "open"),
    ]);
    if (acct.data?.client_id && acct.data.client_id !== clientId) throw new Error("Campaign not found for this client.");
    const calls = await supabase.from("calls").select("call_resource_name", { count: "exact", head: true })
      .eq("customer_id", campaign.customer_id).eq("campaign_id", campaign.campaign_id).eq("is_90s_plus", true)
      .gte("start_at", `${range.from}T00:00:00Z`).lte("start_at", `${range.to}T23:59:59Z`);
    setOpenRecs(recs.count ?? null);
    return {
      campaign,
      currency: (acct.data?.currency_code as string | null) ?? null,
      clientName: (client.data?.name as string | undefined) ?? "Client",
      slug: (client.data?.slug as string | undefined) ?? "client",
      daily: (daily.data ?? []) as DailyRow[],
      calls90: calls.count ?? 0,
    };
  }, [campaignRowId, clientId, range.from, range.to]);

  const tabs: { id: Tab; label: string; badge?: number | null; agencyOnly?: boolean }[] = [
    { id: "assistant", label: "Campaign Assistant", agencyOnly: true },
    { id: "performance", label: "Performance" },
    { id: "keywords", label: "Keywords" },
    { id: "search_terms", label: "Search Terms" },
    { id: "negatives", label: "Negatives" },
    { id: "ads", label: "Ads & Assets" },
    { id: "time", label: "Time & Device" },
    { id: "conversions", label: "Conversions" },
    { id: "recommendations", label: "Recommendations", badge: openRecs },
    { id: "suggestions", label: "Client Suggestions" },
    { id: "changes", label: "Change History", agencyOnly: true },
  ];
  const visible = tabs.filter((t) => agency || !t.agencyOnly);
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && visible.some((t) => t.id === requested) ? requested : agency ? "assistant" : "performance";
  const setTab = (t: Tab) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true });

  const back = { to: `/dashboard/clients/${clientId}?range=${range.key}${range.key === "custom" ? `&from=${range.from}&to=${range.to}` : ""}`, label: data?.clientName ?? "Client" };

  if (error) {
    return (
      <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
        <div className="mx-auto max-w-7xl"><AppHeader title="Campaign" back={back} /><div className="mt-8"><ErrorNote message={error} /></div></div>
      </main>
    );
  }
  if (loading && !data) return <main className="min-h-screen bg-page px-6 py-10"><Loading /></main>;
  if (!data) return null;

  const { campaign: c, currency, daily } = data;
  const t = daily.reduce(
    (a, d) => ({
      cost: a.cost + Number(d.cost_micros), impr: a.impr + Number(d.impressions), clicks: a.clicks + Number(d.clicks),
      conv: a.conv + Number(d.conversions), value: a.value + Number(d.conversions_value), calls: a.calls + Number(d.phone_calls),
      eligible: a.eligible + (d.search_impression_share ? Number(d.impressions) / Number(d.search_impression_share) : 0),
      isImpr: a.isImpr + (d.search_impression_share ? Number(d.impressions) : 0),
    }),
    { cost: 0, impr: 0, clicks: 0, conv: 0, value: 0, calls: 0, eligible: 0, isImpr: 0 },
  );
  const roas = t.cost > 0 ? t.value / (t.cost / 1e6) : null;
  const props: TabProps = {
    clientId, campaignRowId, customerId: c.customer_id, campaignId: c.campaign_id, currency, range, agency,
    isRob: profile?.role === "rob_admin", csvBase: `${data.slug}-${c.campaign_id}-${range.from}-${range.to}`,
  };

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <AppHeader
          title={c.name}
          back={back}
          subtitle={
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <StatusPill status={c.removed_at ? "REMOVED" : c.status} />
              <span>{moneyMicros(c.budget_micros, currency)}/day{c.budget_shared ? " (shared budget)" : ""}</span>
              <span>- {enumLabel(c.bidding_strategy_type)}</span>
              <span>- Customer ID {fmtId(c.customer_id)}</span>
              {c.positive_geo_target_type && c.positive_geo_target_type !== "PRESENCE" && <span className="text-warning">- targets interest too, not presence only</span>}
            </span>
          }
        />
        <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
          <p className="text-xs text-ink-subtle">Data synced {dateTime(c.synced_at)}</p>
          <DateRangePicker range={range} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatCard label="Cost" value={moneyMicros(t.cost, currency)} />
          <StatCard label="Conversions" value={dec(t.conv, 1)} />
          <StatCard label="Cost / conv." value={moneyMicros(costPerConvMicros(t.cost, t.conv), currency)} />
          <StatCard label="Conv. value" value={moneyMicros(t.value * 1e6, currency)} sub={roas === null ? "ROAS -" : `ROAS ${roas.toFixed(2)}x`} />
          <StatCard label="Calls 90s+" value={int(data.calls90)} sub={`${int(t.calls)} calls from ads`} />
          <StatCard label="Search IS" value={pct(t.eligible > 0 ? t.isImpr / t.eligible : null, 0)} />
          <StatCard label="Impressions" value={int(t.impr)} />
          <StatCard label="Clicks" value={int(t.clicks)} />
          <StatCard label="CTR" value={pct(ctr(t.clicks, t.impr))} />
          <StatCard label="Avg. CPC" value={moneyMicros(avgCpcMicros(t.cost, t.clicks), currency)} />
        </div>

        <div className="mt-10">
          <Tabs tabs={visible} active={tab} onChange={setTab} />
          <p className="print-only mt-4 text-sm font-semibold">{visible.find((x) => x.id === tab)?.label}</p>
        </div>
        <section className="mt-6">
          {tab === "assistant" && agency && (
            <CampaignChat campaignRowId={campaignRowId} customerId={c.customer_id} campaignId={c.campaign_id} currency={currency} />
          )}
          {tab === "performance" && <PerformanceTab daily={daily} currency={currency} />}
          {tab === "keywords" && <KeywordsTab {...props} />}
          {tab === "search_terms" && <SearchTermsTab {...props} />}
          {tab === "negatives" && <NegativesTab {...props} />}
          {tab === "ads" && <AdsAssetsTab {...props} />}
          {tab === "time" && <TimeDeviceTab {...props} />}
          {tab === "conversions" && <ConversionsTab {...props} />}
          {tab === "recommendations" && <RecommendationsTab {...props} />}
          {tab === "suggestions" && (
            <MessageThread clientId={clientId} campaignRowId={campaignRowId} customerId={c.customer_id} campaignId={c.campaign_id} currency={currency} />
          )}
          {tab === "changes" && agency && <ChangeHistoryTab {...props} />}
        </section>
      </div>
    </main>
  );
}
