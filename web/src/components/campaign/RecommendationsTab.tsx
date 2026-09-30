import { useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { actions, type Recommendation } from "../../lib/api";
import { N8nError } from "../../lib/n8n";
import { useAsync } from "../../lib/useAsync";
import { dec, enumLabel, int, moneyMicros } from "../../lib/format";
import { Button, ErrorNote, Loading } from "../ui";
import type { TabProps } from "./types";

// Google's open recommendations for the campaign (reference Recommendations
// tab). Hiding one only hides it on the dashboard; nothing is applied in
// Google Ads from here.
export default function RecommendationsTab(p: TabProps) {
  const [showHidden, setShowHidden] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(async () => {
    const { data: rows, error: e } = await supabase
      .from("recommendations")
      .select("resource_name, type, status, est_extra_clicks, est_extra_conversions, est_cost_change_micros, last_seen_at")
      .eq("customer_id", p.customerId)
      .eq("campaign_id", p.campaignId)
      .in("status", showHidden ? ["open", "hidden"] : ["open"])
      .order("est_extra_conversions", { ascending: false });
    if (e) throw new Error(e.message);
    return rows as Recommendation[];
  }, [p.customerId, p.campaignId, showHidden]);

  async function toggle(r: Recommendation) {
    setMsg(null);
    try {
      await actions.review({ action: r.status === "hidden" ? "unhide_recommendation" : "hide_recommendation", resource_name: r.resource_name });
      reload();
    } catch (e) {
      setMsg(e instanceof N8nError ? e.message : "Could not update.");
    }
  }

  if (error) return <ErrorNote message={error} />;
  if (loading && !data) return <Loading />;
  return (
    <div className="space-y-3">
      {p.agency && (
        <label className="no-print flex items-center gap-2 text-xs text-ink-muted">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden
        </label>
      )}
      {msg && <ErrorNote message={msg} />}
      {data?.length === 0 && <p className="text-sm text-ink-subtle">No open recommendations.</p>}
      {data?.map((r) => (
        <div key={r.resource_name} className="card flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface p-4">
          <div>
            <p className="font-semibold">{enumLabel(r.type)}{r.status === "hidden" && <span className="ml-2 text-xs text-ink-subtle">(hidden)</span>}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {Number(r.est_extra_conversions) ? `Est. +${dec(r.est_extra_conversions, 1)} conversions. ` : ""}
              {Number(r.est_extra_clicks) ? `Est. +${int(r.est_extra_clicks)} clicks. ` : ""}
              {Number(r.est_cost_change_micros) ? `Cost change ${moneyMicros(r.est_cost_change_micros, p.currency)}.` : ""}
              {!Number(r.est_extra_conversions) && !Number(r.est_extra_clicks) && "Google gave no estimate for this one."}
            </p>
          </div>
          {p.agency && <Button size="sm" onClick={() => toggle(r)}>{r.status === "hidden" ? "Show again" : "Hide"}</Button>}
        </div>
      ))}
      <p className="text-xs text-ink-subtle">Review each recommendation before acting; FF never auto-applies them.</p>
    </div>
  );
}
