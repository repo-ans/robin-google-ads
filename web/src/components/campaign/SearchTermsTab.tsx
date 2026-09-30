import { useState } from "react";
import { actions, rpc, type SearchTermRow } from "../../lib/api";
import { N8nError } from "../../lib/n8n";
import { useAsync } from "../../lib/useAsync";
import { costPerConvMicros, ctr, dec, enumLabel, int, moneyMicros, pct } from "../../lib/format";
import DataTable from "../DataTable";
import { ErrorNote, Loading, Notice, Pill } from "../ui";
import type { TabProps } from "./types";

const DECISIONS: { id: "keep" | "block" | "ask_rob"; label: string }[] = [
  { id: "keep", label: "Keep" },
  { id: "block", label: "Block" },
  { id: "ask_rob", label: "Ask Rob" },
];

// Search terms report, with "already a negative" and the weekly triage
// (keep / block / ask Rob). Terms containing a person's name were replaced
// before they were stored (hard rule 4).
export default function SearchTermsTab(p: TabProps) {
  const [filter, setFilter] = useState<"all" | "no_conv" | "untriaged">("all");
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error, loading, setData } = useAsync(
    () => rpc<SearchTermRow>("dash_search_terms", { p_customer_id: p.customerId, p_campaign_id: p.campaignId, p_from: p.range.from, p_to: p.range.to }),
    [p.customerId, p.campaignId, p.range.from, p.range.to],
  );

  async function decide(row: SearchTermRow, decision: "keep" | "block" | "ask_rob") {
    setMsg(null);
    try {
      await actions.review({ action: "triage", customer_id: p.customerId, campaign_id: p.campaignId, term_hash: row.term_hash, decision });
      setData((rows) => (rows ?? []).map((r) => (r.term_hash === row.term_hash ? { ...r, decision } : r)));
    } catch (e) {
      setMsg(e instanceof N8nError ? e.message : "Could not save the decision.");
    }
  }

  if (error) return <ErrorNote message={error} />;
  if (loading && !data) return <Loading />;
  const all = data ?? [];
  const rows = all.filter((r) =>
    filter === "no_conv" ? Number(r.conversions) === 0 && r.cost_micros > 0 : filter === "untriaged" ? !r.decision : true,
  );
  const filteredCount = all.filter((r) => r.name_filtered).length;
  const cur = p.currency;

  return (
    <div className="space-y-3">
      {filteredCount > 0 && (
        <Notice tone="info">
          {filteredCount} term(s) contained a person's name and are shown as "[name removed]". Their spend is still counted.
        </Notice>
      )}
      {msg && <ErrorNote message={msg} />}
      <DataTable
        rows={rows}
        rowKey={(r) => `${r.term_hash}-${r.ad_group_id}`}
        csvName={`${p.csvBase}-search-terms`}
        initialSort={{ key: "cost", dir: "desc" }}
        empty="No search terms for this period."
        toolbar={
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Show"
            className="rounded-lg border border-line-strong bg-surface px-2 py-1.5 text-xs text-ink">
            <option value="all">All terms</option>
            <option value="no_conv">Spend, no conversions</option>
            <option value="untriaged">Not triaged yet</option>
          </select>
        }
        columns={[
          {
            key: "term", label: "Search term", value: (r) => r.search_term,
            render: (r) => (
              <div>
                <p className={r.name_filtered ? "italic text-ink-subtle" : "font-medium"}>{r.search_term}</p>
                <p className="text-xs text-ink-subtle">{r.ad_group_name}</p>
              </div>
            ),
          },
          { key: "kw", label: "Matched keyword", value: (r) => r.keyword_text ?? "", render: (r) => <span>{r.keyword_text ?? "-"} <span className="text-xs text-ink-subtle">{enumLabel(r.search_term_match_type)}</span></span> },
          {
            key: "neg", label: "Already negative", value: (r) => (r.is_negated || r.status === "EXCLUDED" ? "yes" : "no"),
            render: (r) => (r.is_negated || r.status === "EXCLUDED" ? <Pill tone="info">yes</Pill> : <span className="text-ink-subtle">no</span>),
          },
          { key: "status", label: "Google status", value: (r) => enumLabel(r.status) },
          { key: "impr", label: "Impr.", align: "right", value: (r) => Number(r.impressions), render: (r) => int(r.impressions) },
          { key: "clicks", label: "Clicks", align: "right", value: (r) => Number(r.clicks), render: (r) => int(r.clicks) },
          { key: "ctr", label: "CTR", align: "right", value: (r) => ctr(Number(r.clicks), Number(r.impressions)), render: (r) => pct(ctr(Number(r.clicks), Number(r.impressions))) },
          { key: "cost", label: "Cost", align: "right", value: (r) => r.cost_micros / 1e6, render: (r) => moneyMicros(r.cost_micros, cur) },
          { key: "conv", label: "Conv.", align: "right", value: (r) => Number(r.conversions), render: (r) => dec(r.conversions, 1) },
          { key: "cpa", label: "Cost / conv.", align: "right", value: (r) => costPerConvMicros(r.cost_micros, Number(r.conversions)), render: (r) => moneyMicros(costPerConvMicros(r.cost_micros, Number(r.conversions)), cur) },
          {
            key: "decision", label: "Triage", value: (r) => r.decision ?? "",
            render: (r) =>
              p.agency && !r.name_filtered ? (
                <div className="no-print flex gap-1">
                  {DECISIONS.map((d) => (
                    <button key={d.id} onClick={() => decide(r, d.id)}
                      className={"rounded px-2 py-0.5 text-xs font-semibold " + (r.decision === d.id ? "bg-accent text-accent-ink" : "bg-surface-muted text-ink-muted hover:text-ink")}>
                      {d.label}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-xs">{DECISIONS.find((d) => d.id === r.decision)?.label ?? "-"}</span>
              ),
          },
        ]}
      />
      {p.agency && <p className="text-xs text-ink-subtle">"Block" records the decision for the weekly review. Adding the negative in Google Ads is done by Rob.</p>}
    </div>
  );
}
