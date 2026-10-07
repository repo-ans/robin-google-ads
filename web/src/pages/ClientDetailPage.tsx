import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { actions, rpc, type AccountHealth, type AdAccount, type CampaignTotals, type Client, type WeeklyStat } from "../lib/api";
import { N8nError } from "../lib/n8n";
import { useAuth } from "../lib/auth";
import { isAgency } from "../lib/types";
import { useDateRange } from "../lib/dateRange";
import { useAsync } from "../lib/useAsync";
import { costPerConvMicros, customerId, date, dateTime, dec, int, moneyMicros, pct } from "../lib/format";
import AppHeader from "../components/AppHeader";
import DataTable from "../components/DataTable";
import DateRangePicker from "../components/DateRangePicker";
import ClientForm from "../components/ClientForm";
import MessageThread from "../components/MessageThread";
import ClientSetup from "../components/ClientSetup";
import ProfitSummary from "../components/ProfitSummary";
import { Button, ConfirmDialog, ErrorNote, Notice, PageSkeleton, Pill, Section, StatCard, StatusPill, linkButtonClass } from "../components/ui";

type TrackingFlag = { customer_id: string; name: string; last_conversion_date: string | null; flag_no_recent_conversions: boolean; flag_call_duration_not_90s: boolean; phone_call_duration_seconds: number | null };

export default function ClientDetailPage() {
  const { clientId = "" } = useParams<{ clientId: string }>();
  const { profile } = useAuth();
  const agency = isAgency(profile?.role);
  const isRob = profile?.role === "rob_admin";
  const range = useDateRange();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState<CampaignTotals | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    const [client, accounts, campaigns, health, flags, weeks] = await Promise.all([
      supabase.from("clients").select("*").eq("id", clientId).maybeSingle(),
      supabase.from("ad_accounts").select("*").eq("client_id", clientId).order("customer_id"),
      rpc<CampaignTotals>("dash_campaign_totals", { p_client_id: clientId, p_from: range.from, p_to: range.to }),
      supabase.from("v_account_health").select("*").eq("client_id", clientId),
      supabase.from("v_tracking_health").select("customer_id, name, last_conversion_date, flag_no_recent_conversions, flag_call_duration_not_90s, phone_call_duration_seconds")
        .or("flag_no_recent_conversions.eq.true,flag_call_duration_not_90s.eq.true"),
      supabase.from("weekly_stats").select("*").eq("client_id", clientId).order("week_start", { ascending: false }).limit(12),
    ]);
    if (client.error) throw new Error(client.error.message);
    if (!client.data) throw new Error("Client not found.");
    const accountIds = new Set((accounts.data ?? []).map((a) => a.customer_id));
    return {
      client: client.data as Client,
      accounts: (accounts.data ?? []) as AdAccount[],
      campaigns,
      health: (health.data ?? []) as AccountHealth[],
      flags: ((flags.data ?? []) as TrackingFlag[]).filter((f) => accountIds.has(f.customer_id)),
      weeks: (weeks.data ?? []) as WeeklyStat[],
    };
  }, [clientId, range.from, range.to]);

  async function act(label: string, fn: () => Promise<{ message?: string } | unknown>, done = "Done.") {
    setBusy(label);
    setMessage(null);
    try {
      const r = (await fn()) as { message?: string } | undefined;
      setMessage(r?.message ?? done);
      reload();
    } catch (e) {
      setMessage(e instanceof N8nError ? e.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const back = agency ? { to: "/dashboard", label: "All clients" } : undefined;
  if (error) {
    return (
      <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
        <div className="mx-auto max-w-7xl"><AppHeader title="Client" back={back} /><div className="mt-8"><ErrorNote message={error} /></div></div>
      </main>
    );
  }
  if (loading && !data) return <PageSkeleton cards />;
  if (!data) return null;

  const { client } = data;
  const campaigns = data.campaigns.filter((c) => showRemoved || !c.removed_at);
  const currency = data.accounts[0]?.currency_code ?? client.currency_code;
  const sum = (k: keyof CampaignTotals) => data.campaigns.reduce((s, c) => s + Number(c[k] ?? 0), 0);
  const cost = sum("cost_micros");
  const conv = sum("conversions");
  const qs = `?range=${range.key}${range.key === "custom" ? `&from=${range.from}&to=${range.to}` : ""}`;
  const online = client.process === "online_cremation";
  const latestWeek = data.weeks[0];

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <AppHeader
          title={client.name}
          subtitle={[client.website_url, client.towns.join(", ")].filter(Boolean).join(" - ") || undefined}
          back={back}
        />
        {agency && (
          <div className="no-print mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setEditing(true)}>Edit client</Button>
            <Link to={`/dashboard/clients/${clientId}/users`} className={linkButtonClass}>Client logins</Link>
            <Link to={`/dashboard/clients/${clientId}/audit`} className={linkButtonClass}>Audit</Link>
            <Link to={`/dashboard/clients/${clientId}/case-match`} className={linkButtonClass}>Case match</Link>
            {isRob && (
              <Button size="sm" variant={client.writes_enabled ? "danger" : "subtle"} disabled={!!busy}
                onClick={() => act("writes", () => actions.clientAdmin({ action: "set_writes_enabled", client_id: clientId, enabled: !client.writes_enabled }))}>
                {client.writes_enabled ? "Turn Google Ads writes off" : "Turn Google Ads writes on"}
              </Button>
            )}
          </div>
        )}
        {agency && (
          <p className="mt-2 text-xs text-ink-subtle">
            Google Ads writes for this client: {client.writes_enabled ? <Pill tone="warn">on (Rob)</Pill> : <Pill>off - test accounts only</Pill>}
          </p>
        )}
        {message && <p className="no-print mt-3 text-sm text-ink-muted">{message}</p>}

        <div className="mt-6 flex justify-end"><DateRangePicker range={range} /></div>
        <ProfitSummary clientId={clientId} from={range.from} to={range.to} periodLabel={range.label} />

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Cost" value={moneyMicros(cost, currency)} />
          <StatCard label="Clicks" value={int(sum("clicks"))} />
          <StatCard label="Conversions" value={dec(conv, 1)} />
          <StatCard label="Cost / conv." value={moneyMicros(costPerConvMicros(cost, conv), currency)} />
          <StatCard label="Calls 90s+" value={int(sum("calls_90s"))} />
          <StatCard label="Conv. value" value={moneyMicros(sum("conversions_value") * 1e6, currency)} />
        </div>

        <Section
          title="Campaigns"
          actions={agency ? <Link to={`/dashboard/clients/${clientId}/builder`} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink hover:bg-accent-hover">+ Add Campaign</Link> : undefined}
        >
          <DataTable
            rows={campaigns}
            rowKey={(c) => c.id}
            csvName={`${client.slug}-campaigns-${range.from}-${range.to}`}
            initialSort={{ key: "cost", dir: "desc" }}
            empty="No campaigns yet. They appear after the next sync."
            toolbar={
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                <input type="checkbox" checked={showRemoved} onChange={(e) => setShowRemoved(e.target.checked)} /> Show removed
              </label>
            }
            columns={[
              {
                key: "name", label: "Campaign", value: (c) => c.name,
                render: (c) => (
                  <div>
                    <Link to={`/dashboard/clients/${clientId}/campaigns/${c.id}${qs}`} className="font-medium hover:underline">{c.name}</Link>
                    <p className="text-xs text-ink-subtle">{customerId(c.customer_id)}</p>
                  </div>
                ),
              },
              { key: "status", label: "Status", value: (c) => (c.removed_at ? "REMOVED" : c.status), render: (c) => <StatusPill status={c.removed_at ? "REMOVED" : c.status} /> },
              { key: "budget", label: "Budget / day", align: "right", value: (c) => (c.budget_micros ?? 0) / 1e6, render: (c) => moneyMicros(c.budget_micros, c.currency_code) },
              { key: "cost", label: "Cost", align: "right", value: (c) => c.cost_micros / 1e6, render: (c) => moneyMicros(c.cost_micros, c.currency_code) },
              { key: "clicks", label: "Clicks", align: "right", value: (c) => Number(c.clicks), render: (c) => int(c.clicks) },
              { key: "conv", label: "Conv.", align: "right", value: (c) => Number(c.conversions), render: (c) => dec(c.conversions, 1) },
              {
                key: "cpa", label: "Cost / conv.", align: "right",
                value: (c) => { const v = costPerConvMicros(c.cost_micros, Number(c.conversions)); return v === null ? null : v / 1e6; },
                render: (c) => moneyMicros(costPerConvMicros(c.cost_micros, Number(c.conversions)), c.currency_code),
              },
              { key: "calls", label: "Calls 90s+", align: "right", value: (c) => Number(c.calls_90s) },
              { key: "is", label: "Search IS", align: "right", value: (c) => c.search_impression_share, render: (c) => pct(c.search_impression_share, 0) },
              ...(isRob
                ? [{
                  key: "actions", label: "", noCsv: true, noPrint: true, value: () => null,
                  render: (c: CampaignTotals) => !c.removed_at && <Button size="sm" variant="danger" onClick={() => setRemoving(c)}>Remove</Button>,
                }]
                : []),
            ]}
          />
        </Section>

        {agency && (
          <ClientSetup
            client={client}
            warnings={[
              ...data.health.flatMap((h) => [
                ...(h.flag_auto_tagging_off ? [`${h.descriptive_name ?? h.customer_id}: auto-tagging is off, so forms cannot capture the ad click.`] : []),
                ...(h.flag_call_reporting_off ? [`${h.descriptive_name ?? h.customer_id}: call reporting is off, so calls of 90s+ cannot be counted.`] : []),
                ...(h.campaigns_not_presence_only > 0 ? [`${h.descriptive_name ?? h.customer_id}: ${h.campaigns_not_presence_only} enabled campaign(s) also target people only interested in the area.`] : []),
              ]),
              ...data.flags.map((f) => [
                f.flag_no_recent_conversions ? `"${f.name}" has had spend but no conversions for 14+ days (last: ${f.last_conversion_date ?? "never"}).` : "",
                f.flag_call_duration_not_90s ? `"${f.name}" counts calls of ${f.phone_call_duration_seconds ?? "the default"} seconds, not 90.` : "",
              ].filter(Boolean).join(" ")),
            ]}
          />
        )}

        <Section
          title="Weekly report"
          hint="Monday to Sunday, made every Monday morning. The same row goes to the client's Google Sheet, and a short note to Rob on Slack."
        >
          <DataTable
            rows={data.weeks}
            rowKey={(w) => w.week_start}
            csvName={`${client.slug}-weekly`}
            empty="No weekly report yet. The first one is made by itself next Monday."
            columns={[
              { key: "week", label: "Week", value: (w) => w.week_start, render: (w) => `${date(w.week_start)} - ${date(w.week_end)}` },
              { key: "cost", label: "Spend", align: "right", value: (w) => w.cost_micros / 1e6, render: (w) => moneyMicros(w.cost_micros, w.currency_code) },
              { key: "clicks", label: "Clicks", align: "right", value: (w) => Number(w.clicks), render: (w) => int(w.clicks) },
              ...(online
                ? [
                  { key: "arr", label: "Arrangements", align: "right" as const, value: (w: WeeklyStat) => Number(w.arrangements), render: (w: WeeklyStat) => dec(w.arrangements, 0) },
                  { key: "arrv", label: "Value", align: "right" as const, value: (w: WeeklyStat) => Number(w.arrangements_value), render: (w: WeeklyStat) => moneyMicros(Number(w.arrangements_value) * 1e6, w.currency_code) },
                ]
                : [
                  { key: "calls", label: "Calls 90s+", align: "right" as const, value: (w: WeeklyStat) => Number(w.calls_90s), render: (w: WeeklyStat) => dec(w.calls_90s, 0) },
                  { key: "forms", label: "Forms", align: "right" as const, value: (w: WeeklyStat) => Number(w.forms), render: (w: WeeklyStat) => dec(w.forms, 0) },
                  { key: "ghl", label: "GHL leads", align: "right" as const, value: (w: WeeklyStat) => w.ghl_google_leads, render: (w: WeeklyStat) => int(w.ghl_google_leads) },
                ]),
              { key: "cpa", label: "Cost / conv.", align: "right", value: (w) => (w.cost_per_conversion_micros ?? 0) / 1e6, render: (w) => moneyMicros(w.cost_per_conversion_micros, w.currency_code) },
              { key: "tracking", label: "Tracking", value: (w) => (w.tracking_ok ? "OK" : "Check"), render: (w) => (w.tracking_ok ? <Pill tone="good">OK</Pill> : <Pill tone="warn">Check</Pill>) },
              ...(agency ? [{ key: "sheet", label: "Sheet", value: (w: WeeklyStat) => (w.sheet_written_at ? "written" : "-") }] : []),
            ]}
          />
          {latestWeek && (latestWeek.flags.length > 0 || latestWeek.changes.length > 0 || latestWeek.decisions.length > 0) && (
            <div className="card mt-4 rounded-xl border border-line bg-surface p-4 text-sm">
              <p className="font-semibold">Week of {date(latestWeek.week_start)}</p>
              {latestWeek.changes.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-ink-muted">{latestWeek.changes.map((x) => <li key={x}>{x}</li>)}</ul>}
              {latestWeek.flags.length > 0 && <div className="mt-3 space-y-2">{latestWeek.flags.map((x) => <Notice key={x}>{x}</Notice>)}</div>}
              {agency && latestWeek.decisions.length > 0 && (
                <div className="mt-3"><p className="font-medium">For Rob</p><ul className="mt-1 list-disc space-y-1 pl-5 text-ink-muted">{latestWeek.decisions.map((x) => <li key={x}>{x}</li>)}</ul></div>
              )}
            </div>
          )}
        </Section>

        <Section title="Google Ads accounts">
          <DataTable
            rows={data.accounts}
            rowKey={(a) => a.customer_id}
            empty="No Google Ads account is linked to this client yet."
            columns={[
              { key: "name", label: "Account", value: (a) => a.descriptive_name ?? "", render: (a) => <span className="font-medium">{a.descriptive_name ?? "-"}</span> },
              { key: "id", label: "Customer ID", value: (a) => customerId(a.customer_id), render: (a) => <>{customerId(a.customer_id)} {a.is_test_account && <Pill tone="info">test</Pill>}</> },
              { key: "currency", label: "Currency", value: (a) => a.currency_code ?? "" },
              { key: "synced", label: "Last synced", value: (a) => a.last_synced_at ?? "", render: (a) => dateTime(a.last_synced_at) },
            ]}
          />
        </Section>

        <Section title="Client suggestions" hint={agency ? "Everything this client has sent, across campaigns." : "Send us ideas or requests. We reply here."}>
          <MessageThread clientId={clientId} currency={currency} />
        </Section>
      </div>

      {editing && <ClientForm client={client} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); actions.websiteCheck(clientId).catch(() => undefined); reload(); }} />}
      {removing && (
        <ConfirmDialog
          title={`Remove "${removing.name}" in Google Ads?`}
          message="Google sets the campaign to Removed; this cannot be undone in Google Ads. Its history stays in the dashboard. Google checks the change first (validate only), and it is logged."
          confirmLabel="Remove campaign"
          danger
          busy={busy === "remove"}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const c = removing;
            setRemoving(null);
            act("remove", () => actions.deleteCampaign(c.id), "Campaign removed.");
          }}
        />
      )}
    </main>
  );
}
