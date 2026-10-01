import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { actions, rpc, type AdAccount, type Client, type ClientTotals } from "../lib/api";
import { N8nError } from "../lib/n8n";
import { useDateRange } from "../lib/dateRange";
import { useAsync } from "../lib/useAsync";
import { costPerConvMicros, customerId, dec, int, moneyMicros } from "../lib/format";
import AppHeader from "../components/AppHeader";
import DataTable from "../components/DataTable";
import DateRangePicker from "../components/DateRangePicker";
import ClientForm from "../components/ClientForm";
import { Button, ConfirmDialog, ErrorNote, Loading, Notice } from "../components/ui";

type Row = Client & { t: ClientTotals | undefined };

// Agency home (reference DashboardPage): every client with cost, conversions,
// cost per conversion and calls of 90s+, for the chosen period.
export default function DashboardPage() {
  const range = useDateRange();
  const [editing, setEditing] = useState<Client | "new" | null>(null);
  const [archiving, setArchiving] = useState<Client | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, error, loading, reload } = useAsync(async () => {
    const [clients, accounts, totals] = await Promise.all([
      supabase.from("clients").select("*").order("name"),
      supabase.from("ad_accounts").select("customer_id, client_id, status, is_manager").eq("is_manager", false),
      rpc<ClientTotals>("dash_client_totals", { p_from: range.from, p_to: range.to }),
    ]);
    if (clients.error) throw new Error(clients.error.message);
    if (accounts.error) throw new Error(accounts.error.message);
    return { clients: clients.data as Client[], accounts: accounts.data as Pick<AdAccount, "customer_id" | "client_id" | "status">[], totals };
  }, [range.from, range.to]);

  const rows: Row[] = useMemo(() => {
    if (!data) return [];
    const byClient = new Map(data.totals.map((t) => [t.client_id, t]));
    return data.clients.filter((c) => showArchived || !c.archived_at).map((c) => ({ ...c, t: byClient.get(c.id) }));
  }, [data, showArchived]);

  const unassigned = data?.accounts.filter((a) => !a.client_id).length ?? 0;
  const accountsOf = (clientId: string) => (data?.accounts ?? []).filter((a) => a.client_id === clientId);

  async function syncNow() {
    setBusy(true);
    setSyncMsg(null);
    try {
      await actions.syncNow();
      setSyncMsg("Sync started. It runs in the background; see Settings for progress.");
    } catch (e) {
      setSyncMsg(e instanceof N8nError ? e.message : "Could not start the sync.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <AppHeader
          title="Agency Dashboard"
          subtitle="All clients and their Google Ads performance."
          actions={
            <>
              <Button variant="outline" onClick={syncNow} disabled={busy}>{busy ? "Starting..." : "Sync Now"}</Button>
              <Button variant="primary" onClick={() => setEditing("new")}>+ New Client</Button>
            </>
          }
        />
        {syncMsg && <p className="no-print mt-3 text-sm text-ink-muted">{syncMsg}</p>}
        {unassigned > 0 && (
          <div className="mt-6">
            <Notice>
              {unassigned} Google Ads {unassigned === 1 ? "account is" : "accounts are"} not assigned to a client yet.{" "}
              <Link to="/dashboard/accounts" className="font-semibold underline">Assign accounts</Link>
            </Notice>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
          <Link to="/dashboard/accounts" className="no-print text-sm font-semibold text-ink-muted hover:text-ink">Manage Google Ads accounts</Link>
          <DateRangePicker range={range} />
        </div>

        {error && <div className="mt-6"><ErrorNote message={error} /></div>}
        {loading && !data && <Loading />}

        {data && (
          <>
            <div className="mt-6">
              <DataTable
                rows={rows}
                rowKey={(r) => r.id}
                csvName={`ff-clients-${range.from}-${range.to}`}
                initialSort={{ key: "cost", dir: "desc" }}
                empty="No clients yet. Add one with + New Client."
                toolbar={
                  <label className="flex items-center gap-2 text-xs text-ink-muted">
                    <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                    Show archived
                  </label>
                }
                columns={[
                  {
                    key: "name", label: "Client", value: (r) => r.name,
                    render: (r) => (
                      <div>
                        <Link to={`/dashboard/clients/${r.id}?range=${range.key}${range.key === "custom" ? `&from=${range.from}&to=${range.to}` : ""}`} className="font-medium hover:underline">{r.name}</Link>
                        <p className="text-xs text-ink-subtle">{r.process === "online_cremation" ? "Online cremation" : "Funeral home"}{r.archived_at ? " - archived" : ""}</p>
                      </div>
                    ),
                  },
                  { key: "campaigns", label: "Campaigns", align: "right", value: (r) => r.t?.campaigns ?? 0 },
                  {
                    key: "customer", label: "Customer ID",
                    value: (r) => accountsOf(r.id).map((a) => customerId(a.customer_id)).join(", "),
                    render: (r) => <span className="text-ink-subtle">{accountsOf(r.id).map((a) => customerId(a.customer_id)).join(", ") || "-"}</span>,
                  },
                  { key: "status", label: "Status", value: (r) => accountsOf(r.id)[0]?.status ?? "", render: (r) => <span className="text-ink-subtle">{(accountsOf(r.id)[0]?.status ?? "-").toLowerCase()}</span> },
                  { key: "cost", label: "Cost", align: "right", value: (r) => Number(r.t?.cost_micros ?? 0) / 1e6, render: (r) => moneyMicros(r.t?.cost_micros ?? 0, r.t?.currency_code) },
                  { key: "clicks", label: "Clicks", align: "right", value: (r) => Number(r.t?.clicks ?? 0), render: (r) => int(r.t?.clicks ?? 0) },
                  { key: "conv", label: "Conv.", align: "right", value: (r) => Number(r.t?.conversions ?? 0), render: (r) => dec(r.t?.conversions ?? 0, 1) },
                  {
                    key: "cpa", label: "Cost / conv.", align: "right",
                    value: (r) => { const v = costPerConvMicros(Number(r.t?.cost_micros ?? 0), Number(r.t?.conversions ?? 0)); return v === null ? null : v / 1e6; },
                    render: (r) => moneyMicros(costPerConvMicros(Number(r.t?.cost_micros ?? 0), Number(r.t?.conversions ?? 0)), r.t?.currency_code),
                  },
                  { key: "calls", label: "Calls 90s+", align: "right", value: (r) => Number(r.t?.calls_90s ?? 0) },
                  { key: "value", label: "Conv. value", align: "right", value: (r) => Number(r.t?.conversions_value ?? 0), render: (r) => moneyMicros(Number(r.t?.conversions_value ?? 0) * 1e6, r.t?.currency_code) },
                  {
                    key: "actions", label: "Actions", noCsv: true, noPrint: true, value: () => null,
                    render: (r) => (
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => setEditing(r)}>Edit</Button>
                        {!r.archived_at && <Button size="sm" variant="danger" onClick={() => setArchiving(r)}>Archive</Button>}
                      </div>
                    ),
                  },
                ]}
              />
            </div>
          </>
        )}
      </div>

      {editing && (
        <ClientForm
          client={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {archiving && (
        <ConfirmDialog
          title={`Archive ${archiving.name}?`}
          message="The client is hidden from the list. Nothing is deleted and nothing changes in Google Ads. Their logins keep working until you turn them off."
          confirmLabel="Archive"
          danger
          onCancel={() => setArchiving(null)}
          onConfirm={async () => {
            const c = archiving;
            setArchiving(null);
            try {
              await actions.clientAdmin({ action: "archive_client", client_id: c.id });
            } finally {
              reload();
            }
          }}
        />
      )}
    </main>
  );
}
