import { supabase } from "../../lib/supabaseClient";
import { rpc, type AdRow, type AssetLabel, type AssetRow } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { ctr, enumLabel, int, moneyMicros, pct } from "../../lib/format";
import DataTable from "../DataTable";
import { Card, ErrorNote, Loading, Pill, StatusPill } from "../ui";
import type { TabProps } from "./types";

const labelTone = (l: string | null) => (l === "BEST" ? "good" : l === "GOOD" ? "info" : l === "LOW" ? "bad" : "neutral");

// Responsive search ads with each headline/description and its performance
// label, plus the extensions (call, sitelink, callout, snippet).
export default function AdsAssetsTab(p: TabProps) {
  const { data, error, loading } = useAsync(async () => {
    const [ads, labels, assets] = await Promise.all([
      rpc<AdRow>("dash_ads", { p_customer_id: p.customerId, p_campaign_id: p.campaignId, p_from: p.range.from, p_to: p.range.to }),
      supabase.from("ad_asset_labels").select("ad_group_id, ad_id, asset_id, field_type, text, performance_label, pinned_field, enabled, impressions_30d, clicks_30d")
        .eq("customer_id", p.customerId).eq("campaign_id", p.campaignId),
      rpc<AssetRow>("dash_assets", { p_customer_id: p.customerId, p_campaign_id: p.campaignId, p_from: p.range.from, p_to: p.range.to }),
    ]);
    return { ads, labels: (labels.data ?? []) as AssetLabel[], assets };
  }, [p.customerId, p.campaignId, p.range.from, p.range.to]);

  if (error) return <ErrorNote message={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const ads = data.ads.filter((a) => !a.removed_at);
  const labelFor = (a: AdRow, field: "HEADLINE" | "DESCRIPTION", text: string) =>
    data.labels.find((l) => l.ad_id === a.ad_id && l.field_type === field && l.text === text);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-semibold">Ads</h3>
        {ads.length === 0 && <p className="mt-2 text-sm text-ink-subtle">No ads in this campaign.</p>}
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {ads.map((a) => (
            <Card key={a.ad_id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{a.ad_group_name ?? a.ad_group_id}</p>
                <div className="flex flex-wrap gap-1">
                  <StatusPill status={a.status} />
                  <StatusPill status={a.approval_status} />
                  {a.ad_strength && <Pill>strength: {a.ad_strength.toLowerCase()}</Pill>}
                </div>
              </div>
              <p className="mt-1 break-all text-xs text-ink-subtle">
                {a.final_urls[0]}{a.path1 ? ` / ${a.path1}` : ""}{a.path2 ? ` / ${a.path2}` : ""}
              </p>
              <p className="mt-2 text-xs text-ink-muted">
                {int(a.impressions)} impr. - {int(a.clicks)} clicks ({pct(ctr(Number(a.clicks), Number(a.impressions)))}) - {moneyMicros(a.cost_micros, p.currency)} - {Number(a.conversions).toFixed(1)} conv.
              </p>
              {a.policy_topics.length > 0 && (
                <p className="mt-2 text-xs text-danger">Policy: {a.policy_topics.map((t) => enumLabel(t.topic)).join(", ")}</p>
              )}
              <p className="mt-3 text-xs font-semibold uppercase text-ink-subtle">Headlines</p>
              <ul className="mt-1 space-y-1 text-sm">
                {a.headlines.map((h, i) => {
                  const l = labelFor(a, "HEADLINE", h.text);
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-2">
                      <span>{h.text}</span>
                      {h.pinned_field && <Pill>pinned {h.pinned_field.replace("HEADLINE_", "")}</Pill>}
                      {l?.performance_label && <Pill tone={labelTone(l.performance_label)}>{l.performance_label.toLowerCase()}</Pill>}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs font-semibold uppercase text-ink-subtle">Descriptions</p>
              <ul className="mt-1 space-y-1 text-sm">
                {a.descriptions.map((d, i) => {
                  const l = labelFor(a, "DESCRIPTION", d.text);
                  return (
                    <li key={i}>
                      {d.text} {l?.performance_label && <Pill tone={labelTone(l.performance_label)}>{l.performance_label.toLowerCase()}</Pill>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      </div>

      <div>
        <h3 className="font-semibold">Extensions (assets)</h3>
        <div className="mt-3">
          <DataTable
            rows={data.assets.filter((x) => !x.removed_at)}
            rowKey={(x) => `${x.level}-${x.asset_id}-${x.field_type}`}
            csvName={`${p.csvBase}-assets`}
            initialSort={{ key: "type", dir: "asc" }}
            empty="No call, sitelink, callout or snippet assets. The SOP expects a call asset."
            columns={[
              { key: "type", label: "Type", value: (x) => enumLabel(x.field_type) },
              {
                key: "text", label: "Text", value: (x) => x.text ?? x.phone_number ?? "",
                render: (x) => (
                  <div>
                    <p className="font-medium">{x.text ?? x.phone_number ?? "-"}</p>
                    {(x.description1 || x.description2) && <p className="text-xs text-ink-subtle">{[x.description1, x.description2].filter(Boolean).join(" - ")}</p>}
                    {x.field_type === "CALL" && x.call_conversion_reporting_state && <p className="text-xs text-ink-subtle">Call reporting: {enumLabel(x.call_conversion_reporting_state)}</p>}
                  </div>
                ),
              },
              { key: "level", label: "Level", value: (x) => enumLabel(x.level) },
              { key: "status", label: "Status", value: (x) => x.primary_status ?? x.status ?? "", render: (x) => <StatusPill status={x.primary_status ?? x.status} /> },
              { key: "impr", label: "Impr.", align: "right", value: (x) => Number(x.impressions), render: (x) => (x.level === "campaign" ? int(x.impressions) : "-") },
              { key: "clicks", label: "Clicks", align: "right", value: (x) => Number(x.clicks), render: (x) => (x.level === "campaign" ? int(x.clicks) : "-") },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
