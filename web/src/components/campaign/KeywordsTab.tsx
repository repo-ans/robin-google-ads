import { useState } from "react";
import { rpc, type KeywordRow } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { avgCpcMicros, costPerConvMicros, ctr, dec, enumLabel, int, moneyMicros, pct } from "../../lib/format";
import DataTable from "../DataTable";
import { ErrorNote, Loading, Pill, StatusPill } from "../ui";
import type { TabProps } from "./types";

const qsTone = (q: number | null) => (q === null ? "neutral" : q >= 7 ? "good" : q >= 5 ? "warn" : "bad");
const componentLabel = (v: string | null) => (v ? v.replace("_AVERAGE", "").replace(/_/g, " ").toLowerCase() : "-");

// Positive keywords with metrics, Quality Score (and its three parts), bid
// estimates and search volume (Google Keyword Planner + DataForSEO).
export default function KeywordsTab(p: TabProps) {
  const [showRemoved, setShowRemoved] = useState(false);
  const { data, error, loading } = useAsync(
    () => rpc<KeywordRow>("dash_keywords", { p_customer_id: p.customerId, p_campaign_id: p.campaignId, p_from: p.range.from, p_to: p.range.to }),
    [p.customerId, p.campaignId, p.range.from, p.range.to],
  );
  if (error) return <ErrorNote message={error} />;
  if (loading && !data) return <Loading />;
  const rows = (data ?? []).filter((k) => showRemoved || !k.removed_at);
  const cur = p.currency;

  return (
    <DataTable
      rows={rows}
      rowKey={(k) => `${k.ad_group_id}-${k.criterion_id}`}
      csvName={`${p.csvBase}-keywords`}
      initialSort={{ key: "cost", dir: "desc" }}
      empty="No keywords in this campaign."
      toolbar={
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Show removed
        </label>
      }
      rowClassName={(k) => (k.match_type === "BROAD" ? "bg-warning-soft" : "")}
      columns={[
        {
          key: "text", label: "Keyword", value: (k) => k.text,
          render: (k) => (
            <div>
              <p className="font-medium">{k.match_type === "EXACT" ? `[${k.text}]` : k.match_type === "PHRASE" ? `"${k.text}"` : k.text}</p>
              <p className="text-xs text-ink-subtle">{k.ad_group_name}</p>
            </div>
          ),
        },
        { key: "match", label: "Match", value: (k) => enumLabel(k.match_type), render: (k) => (k.match_type === "BROAD" ? <Pill tone="warn">broad</Pill> : enumLabel(k.match_type)) },
        { key: "status", label: "Status", value: (k) => (k.removed_at ? "REMOVED" : k.status), render: (k) => <StatusPill status={k.removed_at ? "REMOVED" : k.status} /> },
        { key: "impr", label: "Impr.", align: "right", value: (k) => Number(k.impressions), render: (k) => int(k.impressions) },
        { key: "clicks", label: "Clicks", align: "right", value: (k) => Number(k.clicks), render: (k) => int(k.clicks) },
        { key: "ctr", label: "CTR", align: "right", value: (k) => ctr(Number(k.clicks), Number(k.impressions)), render: (k) => pct(ctr(Number(k.clicks), Number(k.impressions))) },
        { key: "cpc", label: "Avg. CPC", align: "right", value: (k) => avgCpcMicros(k.cost_micros, Number(k.clicks)), render: (k) => moneyMicros(avgCpcMicros(k.cost_micros, Number(k.clicks)), cur) },
        { key: "cost", label: "Cost", align: "right", value: (k) => k.cost_micros / 1e6, render: (k) => moneyMicros(k.cost_micros, cur) },
        { key: "conv", label: "Conv.", align: "right", value: (k) => Number(k.conversions), render: (k) => dec(k.conversions, 1) },
        { key: "cpa", label: "Cost / conv.", align: "right", value: (k) => costPerConvMicros(k.cost_micros, Number(k.conversions)), render: (k) => moneyMicros(costPerConvMicros(k.cost_micros, Number(k.conversions)), cur) },
        { key: "qs", label: "QS", align: "right", value: (k) => k.quality_score, render: (k) => (k.quality_score === null ? "-" : <Pill tone={qsTone(k.quality_score)}>{k.quality_score}</Pill>) },
        { key: "qs_ctr", label: "Exp. CTR", value: (k) => componentLabel(k.qs_expected_ctr) },
        { key: "qs_ad", label: "Ad relevance", value: (k) => componentLabel(k.qs_creative) },
        { key: "qs_lp", label: "Landing page", value: (k) => componentLabel(k.qs_landing_page) },
        { key: "vol", label: "Google volume", align: "right", value: (k) => k.google_volume, render: (k) => int(k.google_volume) },
        { key: "dfs_vol", label: "DataForSEO volume", align: "right", value: (k) => k.dfs_volume, render: (k) => int(k.dfs_volume) },
        { key: "dfs_cpc", label: "Market CPC (USD)", align: "right", value: (k) => k.dfs_cpc_micros, render: (k) => moneyMicros(k.dfs_cpc_micros, "USD") },
        { key: "first_page", label: "First-page bid", align: "right", value: (k) => k.first_page_cpc_micros, render: (k) => moneyMicros(k.first_page_cpc_micros, cur) },
        { key: "top_page", label: "Top-of-page bid", align: "right", value: (k) => k.top_of_page_cpc_micros, render: (k) => moneyMicros(k.top_of_page_cpc_micros, cur) },
      ]}
    />
  );
}
