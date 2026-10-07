import { useMemo, useState } from "react";
import { rpc } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { int, money } from "../lib/format";

type Month = {
  month: string;
  currency_code: string | null;
  cost_micros: number;
  signed_cases: number;
  signed_value: number;
  sales: number;
  sales_value: number;
  calls_90s: number;
  forms: number;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthLabel = (m: string) => new Date(`${m}T00:00:00`).toLocaleDateString(undefined, { month: "short" });

// The one thing a funeral home owner asks: "did the ads make or lose money?"
// Spend vs money that really came back - signed cases (from the monthly case
// match) and paid online arrangements. Calls and forms are shown as leads only.
export default function ProfitSummary({ clientId, from, to, periodLabel }: { clientId: string; from: string; to: string; periodLabel: string }) {
  const yearFrom = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 11, 1);
    return iso(d);
  }, []);
  const { data } = useAsync(async () => {
    const [period, year] = await Promise.all([
      rpc<Month>("dash_client_profit", { p_client_id: clientId, p_from: from, p_to: to }),
      rpc<Month>("dash_client_profit", { p_client_id: clientId, p_from: yearFrom, p_to: iso(new Date()) }),
    ]);
    return { period, year };
  }, [clientId, from, to, yearFrom]);

  if (!data) return null;
  const cur = data.period[0]?.currency_code ?? data.year[0]?.currency_code ?? null;
  const sum = (rows: Month[], k: keyof Month) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const spend = sum(data.period, "cost_micros") / 1e6;
  const back = sum(data.period, "signed_value") + sum(data.period, "sales_value");
  const cases = sum(data.period, "signed_cases");
  const sales = sum(data.period, "sales");
  const calls = sum(data.period, "calls_90s");
  const forms = sum(data.period, "forms");
  const everMeasured = data.year.some((r) => Number(r.signed_value) > 0 || Number(r.sales_value) > 0);
  const diff = back - spend;
  const ahead = diff >= 0;

  let headline: string;
  let tone: "good" | "bad" | "neutral";
  if (back > 0) {
    headline = ahead
      ? `You are ${money(diff, cur)} ahead.`
      : `You are ${money(-diff, cur)} behind.`;
    tone = ahead ? "good" : "bad";
  } else {
    headline = everMeasured ? "No signed families counted for this period yet." : "Money back is not measured yet.";
    tone = "neutral";
  }
  const toneClass = tone === "good" ? "border-success text-success" : tone === "bad" ? "border-danger text-danger" : "border-line text-ink";

  return (
    <section className="mt-6">
      <div className={`card rounded-xl border-2 bg-surface p-5 ${toneClass}`}>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Profit and loss - {periodLabel}</p>
        <p className="mt-1 text-2xl font-semibold">{headline}</p>
        <p className="mt-2 text-sm text-ink">
          You spent <strong>{money(spend, cur)}</strong> on ads.
          {back > 0 && (
            <> The ads brought back <strong>{money(back, cur)}</strong>
              {cases > 0 && <> from {int(cases)} signed {cases === 1 ? "family" : "families"}</>}
              {cases > 0 && sales > 0 && <> and</>}
              {sales > 0 && <> {int(sales)} online arrangement{sales === 1 ? "" : "s"}</>}
              {spend > 0 && <> - every {money(1, cur)} in ads brought back {money(back / spend, cur)}</>}.</>
          )}
          {" "}Leads: {int(calls)} calls of 90 seconds or more and {int(forms)} form requests.
        </p>
        <p className="mt-2 text-xs text-ink-subtle">
          {everMeasured
            ? "Money back = signed families (added early each month by the case match) and paid online arrangements. The current month fills in after it ends."
            : "Money back appears once signed families are matched each month (case match) or online arrangements are counted. Until then, the leads above show what the ads brought in."}
        </p>
      </div>
      <YearChart rows={data.year} cur={cur} />
    </section>
  );
}

function YearChart({ rows, cur }: { rows: Month[]; cur: string | null }) {
  const [hover, setHover] = useState<number | null>(null);
  if (rows.length === 0) return null;
  const W = 640;
  const H = 180;
  const padL = 56;
  const padB = 24;
  const padT = 10;
  const items = rows.map((r) => ({ m: r.month, spend: Number(r.cost_micros) / 1e6, back: Number(r.signed_value) + Number(r.sales_value) }));
  const max = Math.max(1, ...items.flatMap((i) => [i.spend, i.back]));
  const plotW = W - padL - 8;
  const plotH = H - padT - padB;
  const slot = plotW / items.length;
  const bar = Math.min(18, slot / 3);
  const y = (v: number) => padT + plotH - (v / max) * plotH;
  const h = items[hover ?? -1];

  return (
    <div className="card mt-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span className="font-semibold uppercase tracking-wide">Last 12 months</span>
        <span className="flex gap-4">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-chart-1" />Spent</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-chart-2" />Brought back</span>
        </span>
      </div>
      <p className="mt-1 h-5 text-sm">{h ? `${monthLabel(h.m)}: spent ${money(h.spend, cur)}, brought back ${money(h.back, cur)} (${h.back - h.spend >= 0 ? "+" : "-"}${money(Math.abs(h.back - h.spend), cur)})` : ""}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label="Spent and brought back per month">
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="fill-ink-subtle text-[10px]">{money(t, cur).replace(/\.00$/, "")}</text>
          </g>
        ))}
        {items.map((i, k) => {
          const x = padL + k * slot + slot / 2;
          return (
            <g key={i.m} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + k * slot} y={padT} width={slot} height={plotH} className="fill-transparent" />
              <rect x={x - bar - 1} y={y(i.spend)} width={bar} height={Math.max(0, padT + plotH - y(i.spend))} rx={2} className="fill-chart-1" />
              <rect x={x + 1} y={y(i.back)} width={bar} height={Math.max(0, padT + plotH - y(i.back))} rx={2} className="fill-chart-2" />
              <text x={x} y={H - 6} textAnchor="middle" className="fill-ink-subtle text-[10px]">{monthLabel(i.m)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
