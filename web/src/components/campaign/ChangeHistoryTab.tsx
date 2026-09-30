import { supabase } from "../../lib/supabaseClient";
import type { ChangeEvent } from "../../lib/api";
import { useAsync } from "../../lib/useAsync";
import { dateTime, enumLabel } from "../../lib/format";
import DataTable from "../DataTable";
import { ErrorNote, Loading, Pill } from "../ui";
import type { TabProps } from "./types";

// Who changed what in Google Ads (last 30 days, as far back as Google keeps).
// Agency only. Changes made through the API are highlighted.
export default function ChangeHistoryTab(p: TabProps) {
  const { data, error, loading } = useAsync(async () => {
    const { data: rows, error: e } = await supabase
      .from("change_events")
      .select("resource_name, changed_at, resource_type, operation, client_type, user_email, changed_fields")
      .eq("customer_id", p.customerId)
      .eq("campaign_id", p.campaignId)
      .order("changed_at", { ascending: false })
      .limit(1000);
    if (e) throw new Error(e.message);
    return rows as ChangeEvent[];
  }, [p.customerId, p.campaignId]);

  if (error) return <ErrorNote message={error} />;
  if (loading && !data) return <Loading />;
  return (
    <DataTable
      rows={data ?? []}
      rowKey={(c) => c.resource_name}
      csvName={`${p.csvBase}-changes`}
      initialSort={{ key: "when", dir: "desc" }}
      empty="No changes in the last 30 days."
      columns={[
        { key: "when", label: "When", value: (c) => c.changed_at, render: (c) => dateTime(c.changed_at) },
        { key: "what", label: "What", value: (c) => `${enumLabel(c.operation)} ${enumLabel(c.resource_type)}` },
        { key: "fields", label: "Fields", value: (c) => c.changed_fields.join(", "), render: (c) => <span className="text-xs">{c.changed_fields.slice(0, 6).join(", ")}{c.changed_fields.length > 6 ? "..." : ""}</span> },
        { key: "who", label: "Who", value: (c) => c.user_email ?? "" },
        { key: "via", label: "Via", value: (c) => enumLabel(c.client_type), render: (c) => (c.client_type === "GOOGLE_ADS_API" ? <Pill tone="info">API</Pill> : enumLabel(c.client_type)) },
      ]}
    />
  );
}
