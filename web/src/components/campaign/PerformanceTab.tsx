import type { DailyRow } from "../../lib/api";
import { dec, int, money, pct } from "../../lib/format";
import { TrendChart } from "../charts";

// Reference Performance tab (cost and conversion value by day), plus
// conversions, clicks, calls and impression share.
export default function PerformanceTab({ daily, currency }: { daily: DailyRow[]; currency: string | null }) {
  const series = (f: (d: DailyRow) => number) => daily.map((d) => ({ date: d.date, value: f(d) }));
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <TrendChart title="Cost by day" data={series((d) => d.cost_micros / 1e6)} tone="chart-1" format={(n) => money(n, currency)} />
      <TrendChart title="Conversions by day" data={series((d) => Number(d.conversions))} tone="chart-2" format={(n) => dec(n, 1)} />
      <TrendChart title="Clicks by day" data={series((d) => Number(d.clicks))} tone="chart-3" format={(n) => int(n)} />
      <TrendChart title="Calls from ads by day" data={series((d) => Number(d.phone_calls))} tone="chart-4" format={(n) => int(n)} />
      <TrendChart title="Conv. value by day" data={series((d) => Number(d.conversions_value))} tone="chart-2" format={(n) => money(n, currency)} />
      <TrendChart
        title="Search impression share"
        data={daily.filter((d) => d.search_impression_share !== null).map((d) => ({ date: d.date, value: Number(d.search_impression_share) }))}
        tone="chart-3"
        format={(n) => pct(n, 0)}
      />
    </div>
  );
}
