import { supabase } from "../../lib/supabaseClient";
import { rpc, type AccountHealth, type ConversionRow } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { date, dec, enumLabel } from "../../lib/format";
import DataTable from "../DataTable";
import { ErrorNote, Loading, Notice, Pill, StatusPill } from "../ui";
import type { TabProps } from "./types";

// Conversion actions with their last recorded conversion and the SOP health
// flags (spend with no conversions for 14 days, call actions not at 90s),
// plus the account settings conversions depend on.
export default function ConversionsTab(p: TabProps) {
  const { data, error, loading } = useAsync(async () => {
    const [actionsRows, health] = await Promise.all([
      rpc<ConversionRow>("dash_conversions", { p_customer_id: p.customerId, p_campaign_id: p.campaignId, p_from: p.range.from, p_to: p.range.to }),
      supabase.from("v_account_health").select("*").eq("customer_id", p.customerId).maybeSingle(),
    ]);
    return { actions: actionsRows, health: health.data as AccountHealth | null };
  }, [p.customerId, p.campaignId, p.range.from, p.range.to]);

  if (error) return <ErrorNote message={error} />;
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const h = data.health;
  const hasCall = data.actions.some((a) => ["AD_CALL", "WEBSITE_CALL"].includes(a.type ?? "") && a.status === "ENABLED");

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        {h?.flag_auto_tagging_off && <Notice>Auto-tagging is off. Forms cannot capture the GCLID, so signed cases cannot be matched back to ads.</Notice>}
        {h?.flag_call_reporting_off && <Notice>Call reporting is off. Calls of 90 seconds or more cannot be counted.</Notice>}
        {!hasCall && <Notice>No enabled call conversion action. The SOP counts calls of 90 seconds or more.</Notice>}
        {h && !h.flag_auto_tagging_off && !h.flag_call_reporting_off && hasCall && (
          <p className="text-sm text-success">Auto-tagging and call reporting are on.</p>
        )}
      </div>
      <DataTable
        rows={data.actions}
        rowKey={(a) => a.conversion_action_id}
        csvName={`${p.csvBase}-conversions`}
        initialSort={{ key: "conv", dir: "desc" }}
        empty="No conversion actions in this account."
        rowClassName={(a) => (a.flag_no_recent_conversions || a.flag_call_duration_not_90s ? "bg-warning-soft" : "")}
        columns={[
          { key: "name", label: "Conversion action", value: (a) => a.name, render: (a) => <span className="font-medium">{a.name}</span> },
          { key: "type", label: "Type", value: (a) => enumLabel(a.type) },
          { key: "category", label: "Category", value: (a) => enumLabel(a.category) },
          { key: "status", label: "Status", value: (a) => a.status ?? "", render: (a) => <StatusPill status={a.status} /> },
          { key: "primary", label: "Primary", value: (a) => (a.primary_for_goal ? "yes" : "no") },
          { key: "counting", label: "Counting", value: (a) => enumLabel(a.counting_type) },
          { key: "secs", label: "Call length", value: (a) => a.phone_call_duration_seconds, render: (a) => (a.phone_call_duration_seconds ? `${a.phone_call_duration_seconds}s` : "-") },
          { key: "conv", label: "Conv. (period)", align: "right", value: (a) => Number(a.all_conversions), render: (a) => dec(a.all_conversions, 1) },
          { key: "last", label: "Last conversion", value: (a) => a.last_conversion_date ?? "", render: (a) => date(a.last_conversion_date) },
          {
            key: "health", label: "Health", value: (a) => (a.flag_no_recent_conversions ? "no conversions 14d" : a.flag_call_duration_not_90s ? "not 90s" : "ok"),
            render: (a) =>
              a.flag_no_recent_conversions ? <Pill tone="bad">spend, no conversions 14d</Pill>
                : a.flag_call_duration_not_90s ? <Pill tone="warn">not 90s</Pill>
                  : <Pill tone="good">ok</Pill>,
          },
        ]}
      />
    </div>
  );
}
