import { useState } from "react";
import { rpc, type DeviceRow, type GeoRow, type HourlyRow } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { dec, enumLabel, int, money, moneyMicros } from "../../lib/format";
import { BarList, Heatmap } from "../charts";
import { Card, ErrorNote, Loading, Notice } from "../ui";
import type { TabProps } from "./types";

type Metric = "clicks" | "cost" | "conversions" | "phone_calls" | "impressions";
const METRICS: { id: Metric; label: string }[] = [
  { id: "clicks", label: "Clicks" },
  { id: "cost", label: "Cost" },
  { id: "conversions", label: "Conversions" },
  { id: "phone_calls", label: "Calls from ads" },
  { id: "impressions", label: "Impressions" },
];

// Hour of day x day of week (for bid scheduling), device split, and where the
// spend went: people in the area (presence) vs people interested in it.
export default function TimeDeviceTab(p: TabProps) {
  const [metric, setMetric] = useState<Metric>("clicks");
  const args = { p_customer_id: p.customerId, p_campaign_id: p.campaignId, p_from: p.range.from, p_to: p.range.to };
  const { data, error, loading } = useAsync(async () => {
    const [hourly, device, geo] = await Promise.all([rpc<HourlyRow>("dash_hourly", args), rpc<DeviceRow>("dash_device", args), rpc<GeoRow>("dash_geo", args)]);
    return { hourly, device, geo };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.customerId, p.campaignId, p.range.from, p.range.to]);

  if (error) return <ErrorNote message={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;

  const value = (r: HourlyRow) => (metric === "cost" ? r.cost_micros / 1e6 : Number(r[metric]));
  const fmt = (n: number) => (metric === "cost" ? money(n, p.currency) : metric === "conversions" ? dec(n, 1) : int(n));
  const presence = data.geo.filter((g) => g.location_type === "LOCATION_OF_PRESENCE").reduce((s, g) => s + g.cost_micros, 0);
  const interest = data.geo.filter((g) => g.location_type === "AREA_OF_INTEREST").reduce((s, g) => s + g.cost_micros, 0);
  const places = new Map<string, { label: string; cost: number; clicks: number }>();
  for (const g of data.geo) {
    const label = g.canonical_name ?? g.name ?? (g.geo_target_constant || "Unknown");
    const cur = places.get(label) ?? { label, cost: 0, clicks: 0 };
    cur.cost += g.cost_micros;
    cur.clicks += Number(g.clicks);
    places.set(label, cur);
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">When people search</h3>
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} aria-label="Metric"
            className="no-print rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-xs text-ink">
            {METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div className="mt-3">
          <Heatmap cells={data.hourly.map((r) => ({ day: r.day_of_week, hour: r.hour, value: value(r) }))} format={fmt} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h3 className="font-semibold">Device</h3>
          <div className="mt-3">
            <BarList
              rows={data.device.map((d) => ({ label: enumLabel(d.device), value: d.cost_micros / 1e6, sub: `${int(d.clicks)} clicks, ${dec(d.conversions, 1)} conv.` }))}
              format={(n) => money(n, p.currency)}
            />
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="font-semibold">Location setting (cost)</h3>
          <div className="mt-3">
            <BarList
              tone="chart-2"
              rows={[
                { label: "People in the area", value: presence / 1e6 },
                { label: "People interested in the area", value: interest / 1e6 },
              ].filter((r) => r.value > 0)}
              format={(n) => money(n, p.currency)}
            />
          </div>
          {interest > 0 && <div className="mt-3"><Notice>The SOP targets people in the area only (presence). {moneyMicros(interest, p.currency)} went to people elsewhere.</Notice></div>}
        </Card>
      </div>

      <Card className="p-4">
        <h3 className="font-semibold">Top locations</h3>
        <div className="mt-3">
          <BarList
            tone="chart-4"
            rows={[...places.values()].sort((a, b) => b.cost - a.cost).slice(0, 12).map((g) => ({ label: g.label, value: g.cost / 1e6, sub: `${int(g.clicks)} clicks` }))}
            format={(n) => money(n, p.currency)}
          />
        </div>
      </Card>
    </div>
  );
}
