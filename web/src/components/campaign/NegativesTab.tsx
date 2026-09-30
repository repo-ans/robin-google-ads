import { supabase } from "../../lib/supabaseClient";
import type { NegativeRow } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { enumLabel } from "../../lib/format";
import DataTable from "../DataTable";
import { ErrorNote, Loading } from "../ui";
import type { TabProps } from "./types";

const LEVELS: Record<string, string> = { campaign: "Campaign", ad_group: "Ad group", shared_list: "Shared list", account: "Account" };

// Every negative that applies to this campaign - campaign level, ad group
// level and shared lists - in one table (v_negatives_all).
export default function NegativesTab(p: TabProps) {
  const { data, error, loading } = useAsync(async () => {
    const [neg, groups] = await Promise.all([
      supabase.from("v_negatives_all").select("*").eq("customer_id", p.customerId).eq("campaign_id", p.campaignId).limit(10000),
      supabase.from("ad_groups").select("ad_group_id, name").eq("customer_id", p.customerId).eq("campaign_id", p.campaignId),
    ]);
    if (neg.error) throw new Error(neg.error.message);
    const names = new Map((groups.data ?? []).map((g) => [g.ad_group_id, g.name as string]));
    return (neg.data as NegativeRow[]).map((n) => ({ ...n, ad_group_name: n.ad_group_id ? names.get(n.ad_group_id) ?? n.ad_group_id : null }));
  }, [p.customerId, p.campaignId]);

  if (error) return <ErrorNote message={error} />;
  if (loading && !data) return <Loading />;
  return (
    <DataTable
      rows={data ?? []}
      rowKey={(n) => `${n.level}-${n.list_name ?? ""}-${n.ad_group_id ?? ""}-${n.criterion_id}`}
      csvName={`${p.csvBase}-negatives`}
      initialSort={{ key: "text", dir: "asc" }}
      empty="No negative keywords apply to this campaign. The SOP uses a shared universal list."
      columns={[
        { key: "text", label: "Negative keyword", value: (n) => n.text, render: (n) => <span className="font-medium">{n.match_type === "EXACT" ? `[${n.text}]` : n.match_type === "PHRASE" ? `"${n.text}"` : n.text}</span> },
        { key: "match", label: "Match", value: (n) => enumLabel(n.match_type) },
        { key: "level", label: "Level", value: (n) => LEVELS[n.level] ?? n.level },
        { key: "where", label: "List / ad group", value: (n) => n.list_name ?? n.ad_group_name ?? "" },
      ]}
    />
  );
}
