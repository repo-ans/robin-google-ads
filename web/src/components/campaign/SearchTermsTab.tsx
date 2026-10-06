import { useState } from "react";
import { actions, rpc, type SearchTermRow } from "../../lib/api";
import { N8nError } from "../../lib/n8n";
import { useAsync } from "../../lib/useAsync";
import { costPerConvMicros, ctr, dec, enumLabel, int, moneyMicros, pct } from "../../lib/format";
import DataTable from "../DataTable";
import { Button, ConfirmDialog, ErrorNote, Loading, Notice, Pill, inputClass } from "../ui";
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
  const [done, setDone] = useState<string | null>(null);
  // Rob only: terms picked to become negative keywords in Google Ads.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState<"campaign" | "list">("list");
  const [matchType, setMatchType] = useState<"PHRASE" | "EXACT">("PHRASE");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
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

  async function addNegatives() {
    setBusy(true);
    setMsg(null);
    setDone(null);
    try {
      const r = await actions.addNegatives({ campaign_row_id: p.campaignRowId, level, match_type: matchType, terms: [...picked] });
      setDone(`Added ${r.added} negative keyword(s)${r.skipped ? ` (${r.skipped} were already there)` : ""}. They show as "Already negative" after the next sync.`);
      setPicked(new Set());
    } catch (e) {
      setMsg(e instanceof N8nError ? e.message : "Could not add the negative keywords.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }
  const canPick = (r: SearchTermRow) => p.isRob && !r.name_filtered && !r.is_negated && r.status !== "EXCLUDED";
  const togglePick = (term: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(term)) next.delete(term);
      else if (next.size < 50) next.add(term);
      return next;
    });

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
      {done && <Notice tone="info">{done}</Notice>}
      {p.isRob && (
        <div className="no-print flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-3 text-sm">
          <span className="font-semibold">{picked.size} term(s) picked</span>
          <select className={inputClass + " w-auto"} value={level} onChange={(e) => setLevel(e.target.value as typeof level)} aria-label="Add to">
            <option value="list">FF Universal Negatives list (all campaigns that use it)</option>
            <option value="campaign">This campaign only</option>
          </select>
          <select className={inputClass + " w-auto"} value={matchType} onChange={(e) => setMatchType(e.target.value as typeof matchType)} aria-label="Match type">
            <option value="PHRASE">Phrase match</option>
            <option value="EXACT">Exact match</option>
          </select>
          <Button variant="primary" disabled={picked.size === 0 || busy} onClick={() => setConfirming(true)}>Add as negative</Button>
          {picked.size > 0 && <Button onClick={() => setPicked(new Set())}>Clear</Button>}
        </div>
      )}
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
          ...(p.isRob ? [{
            key: "pick", label: "Pick", noCsv: true, noPrint: true, value: () => null,
            render: (r: SearchTermRow) => canPick(r)
              ? <input type="checkbox" checked={picked.has(r.search_term)} onChange={() => togglePick(r.search_term)} aria-label={`Pick ${r.search_term}`} />
              : null,
          }] : []),
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
      {p.agency && <p className="text-xs text-ink-subtle">"Block" records the decision for the weekly review. Rob picks terms and uses "Add as negative" to add them in Google Ads (checked by Google first, logged).</p>}
      {confirming && (
        <ConfirmDialog
          title={`Add ${picked.size} negative keyword(s)?`}
          message={
            <div className="space-y-2">
              <p>{level === "list" ? 'They go on the "FF Universal Negatives" list, so every campaign that uses the list stops showing for them.' : "They are added to this campaign only."} Match type: {matchType.toLowerCase()}.</p>
              <p className="text-xs">{[...picked].join(", ")}</p>
              <p className="text-xs">Google checks the change first. Every attempt is logged.</p>
            </div>
          }
          confirmLabel="Add in Google Ads"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={addNegatives}
        />
      )}
    </div>
  );
}
