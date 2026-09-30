import { useMemo, useState, type MouseEvent } from "react";

// Small SVG charts on the theme tokens (so they follow light/dark and print).
// TrendChart is the reference app's chart, with the colours made themeable.

type Point = { date: string; value: number };
export type ChartTone = "chart-1" | "chart-2" | "chart-3" | "chart-4";
const STROKE: Record<ChartTone, string> = { "chart-1": "stroke-chart-1", "chart-2": "stroke-chart-2", "chart-3": "stroke-chart-3", "chart-4": "stroke-chart-4" };
const FILL: Record<ChartTone, string> = { "chart-1": "fill-chart-1", "chart-2": "fill-chart-2", "chart-3": "fill-chart-3", "chart-4": "fill-chart-4" };

const WIDTH = 480;
const HEIGHT = 160;
const PAD_LEFT = 52;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;

const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function TrendChart({ title, data, tone = "chart-1", format }: { title: string; data: Point[]; tone?: ChartTone; format: (n: number) => string }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const { points, maxValue, ticks } = useMemo(() => {
    const max = Math.max(1e-9, ...data.map((d) => d.value));
    const xStep = data.length > 1 ? plotWidth / (data.length - 1) : 0;
    const pts = data.map((d, i) => ({
      x: PAD_LEFT + (data.length > 1 ? i * xStep : plotWidth / 2),
      y: PAD_TOP + plotHeight - (d.value / max) * plotHeight,
      ...d,
    }));
    return { points: pts, maxValue: max, ticks: [0, max / 2, max] };
  }, [data, plotWidth, plotHeight]);

  if (data.length === 0) {
    return (
      <div className="card rounded-xl border border-line bg-surface p-4">
        <p className="text-xs font-medium uppercase text-ink-subtle">{title}</p>
        <p className="mt-4 text-sm text-ink-subtle">No data for this period.</p>
      </div>
    );
  }

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaPath = `${linePath} L${points[points.length - 1].x},${PAD_TOP + plotHeight} L${points[0].x},${PAD_TOP + plotHeight} Z`;
  const last = points[points.length - 1];
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const total = data.reduce((s, d) => s + d.value, 0);

  function handleMouseMove(e: MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    let closest = 0;
    let best = Infinity;
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - x);
      if (dist < best) {
        best = dist;
        closest = i;
      }
    });
    setHoverIndex(closest);
  }

  return (
    <div className="card rounded-xl border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase text-ink-subtle">{title}</p>
        <p className="text-xs text-ink-muted">Total {format(total)}</p>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="mt-2 w-full touch-none" onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIndex(null)} role="img" aria-label={title}>
        {ticks.map((t, i) => {
          const y = PAD_TOP + plotHeight - (t / maxValue) * plotHeight;
          return (
            <g key={i}>
              <line x1={PAD_LEFT} x2={WIDTH - PAD_RIGHT} y1={y} y2={y} className="stroke-line" strokeWidth={1} />
              <text x={0} y={y + 3} fontSize={9} className="fill-ink-subtle">{format(t)}</text>
            </g>
          );
        })}
        <path d={areaPath} className={FILL[tone]} opacity={0.12} stroke="none" />
        <path d={linePath} fill="none" className={STROKE[tone]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last.x} cy={last.y} r={3.5} className={`${FILL[tone]} stroke-surface`} strokeWidth={2} />
        {hovered && (
          <>
            <line x1={hovered.x} x2={hovered.x} y1={PAD_TOP} y2={PAD_TOP + plotHeight} className="stroke-line-strong" strokeWidth={1} />
            <circle cx={hovered.x} cy={hovered.y} r={4} className={`${FILL[tone]} stroke-surface`} strokeWidth={2} />
          </>
        )}
      </svg>
      <div className="flex items-center justify-between text-xs text-ink-subtle">
        <span>{shortDate(data[0].date)}</span>
        <span>{shortDate(data[data.length - 1].date)}</span>
      </div>
      <p className="mt-1 h-5 text-sm text-ink-muted">
        {hovered && (
          <>
            <span className="font-semibold">{shortDate(hovered.date)}:</span> {format(hovered.value)}
          </>
        )}
      </p>
    </div>
  );
}

// Day-of-week x hour grid. Cell opacity scales with the value.
const DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
export function Heatmap({ cells, format }: { cells: { day: string; hour: number; value: number }[]; format: (n: number) => string }) {
  const grid = new Map(cells.map((c) => [`${c.day}|${c.hour}`, c.value]));
  const max = Math.max(0, ...cells.map((c) => c.value));
  return (
    <div className="card overflow-x-auto rounded-xl border border-line bg-surface p-4">
      <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-[10px]">
        <thead>
          <tr>
            <th className="w-10" />
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} className="font-normal text-ink-subtle">{h % 3 === 0 ? h : ""}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DAYS.map((d) => (
            <tr key={d}>
              <th className="pr-1 text-left font-medium text-ink-subtle">{d.slice(0, 3)}</th>
              {Array.from({ length: 24 }, (_, h) => {
                const v = grid.get(`${d}|${h}`) ?? 0;
                const intensity = max > 0 ? v / max : 0;
                return (
                  <td key={h} title={`${d.toLowerCase()} ${h}:00 - ${format(v)}`} className="relative h-6 rounded-sm bg-surface-muted">
                    <span className="absolute inset-0 rounded-sm bg-heat" style={{ opacity: intensity * 0.9 }} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-subtle">Darker = more. Hours are in the account time zone. Busiest cell: {format(max)}.</p>
    </div>
  );
}

// Horizontal share bars (device split, presence vs interest).
export function BarList({ rows, format, tone = "chart-3" }: { rows: { label: string; value: number; sub?: string }[]; format: (n: number) => string; tone?: ChartTone }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  const bg = { "chart-1": "bg-chart-1", "chart-2": "bg-chart-2", "chart-3": "bg-chart-3", "chart-4": "bg-chart-4" }[tone];
  if (!rows.length || total === 0) return <p className="py-4 text-sm text-ink-subtle">No data for this period.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const share = r.value / total;
        return (
          <li key={r.label}>
            <div className="flex justify-between gap-2 text-sm">
              <span className="font-medium">{r.label}</span>
              <span className="tabular-nums text-ink-muted">
                {format(r.value)} ({Math.round(share * 100)}%){r.sub ? ` - ${r.sub}` : ""}
              </span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-surface-muted">
              <div className={`h-2 rounded-full ${bg}`} style={{ width: `${Math.max(1, share * 100)}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
