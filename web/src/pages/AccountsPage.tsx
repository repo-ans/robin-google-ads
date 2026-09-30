import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabaseClient";
import { actions, type AdAccount } from "../lib/api";
import { N8nError } from "../lib/n8n";
import { useAsync } from "../lib/useAsync";
import { customerId, dateTime } from "../lib/format";
import AppHeader from "../components/AppHeader";
import DataTable from "../components/DataTable";
import { Button, ErrorNote, Field, Loading, Pill, Section, inputClass } from "../components/ui";

// Every Google Ads account FF can reach. Accounts found under the MCC arrive
// here as Unassigned; staff give each one to a client (replaces the reference's
// placeholder "discovered" clients).
export default function AccountsPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ customer_id: "", login_customer_id: "" });

  const { data, error, loading, reload } = useAsync(async () => {
    const [accounts, clients] = await Promise.all([
      supabase.from("ad_accounts").select("*").eq("is_manager", false).order("descriptive_name"),
      supabase.from("clients").select("id, name").is("archived_at", null).order("name"),
    ]);
    if (accounts.error) throw new Error(accounts.error.message);
    if (clients.error) throw new Error(clients.error.message);
    return { accounts: accounts.data as AdAccount[], clients: clients.data as { id: string; name: string }[] };
  }, []);

  async function act(label: string, body: Record<string, unknown>) {
    setBusy(label);
    setMessage(null);
    try {
      const r = await actions.clientAdmin(body);
      setMessage(r.message ?? "Saved.");
      reload();
    } catch (e) {
      setMessage(e instanceof N8nError ? e.message : "Could not save.");
    } finally {
      setBusy(null);
    }
  }

  async function addAccount(e: FormEvent) {
    e.preventDefault();
    await act("add", { action: "add_account", customer_id: form.customer_id, login_customer_id: form.login_customer_id || null });
    setForm({ customer_id: "", login_customer_id: "" });
  }

  const clientName = (id: string | null) => data?.clients.find((c) => c.id === id)?.name ?? null;

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <AppHeader title="Google Ads accounts" subtitle="Assign each account to its client. Unassigned accounts are synced but no client can see them." back={{ to: "/dashboard", label: "Dashboard" }} />
        {message && <p className="no-print mt-4 text-sm text-ink-muted">{message}</p>}
        {error && <div className="mt-6"><ErrorNote message={error} /></div>}
        {loading && !data && <Loading />}
        {data && (
          <div className="mt-8">
            <DataTable
              rows={data.accounts}
              rowKey={(a) => a.customer_id}
              csvName="ff-google-ads-accounts"
              initialSort={{ key: "client", dir: "asc" }}
              empty="No accounts yet. Run a sync, or add a direct-access account below."
              columns={[
                {
                  key: "name", label: "Account", value: (a) => a.descriptive_name ?? "",
                  render: (a) => (
                    <div>
                      <p className="font-medium">{a.descriptive_name ?? "(no name yet)"}</p>
                      <p className="text-xs text-ink-subtle">
                        {customerId(a.customer_id)}
                        {a.is_test_account && <> - <Pill tone="info">test account</Pill></>}
                        {!a.login_customer_id && " - direct access"}
                      </p>
                    </div>
                  ),
                },
                {
                  key: "client", label: "Client", value: (a) => clientName(a.client_id) ?? "~ Unassigned",
                  render: (a) => (
                    <select
                      aria-label={`Client for ${a.customer_id}`}
                      className={inputClass + " no-print max-w-56"}
                      value={a.client_id ?? ""}
                      disabled={!!busy}
                      onChange={(e) => act(`assign-${a.customer_id}`, { action: "assign_account", customer_id: a.customer_id, client_id: e.target.value || null })}
                    >
                      <option value="">Unassigned</option>
                      {data.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  ),
                },
                { key: "currency", label: "Currency", value: (a) => a.currency_code ?? "" },
                { key: "status", label: "Status", value: (a) => a.status ?? "" },
                { key: "synced", label: "Last synced", value: (a) => a.last_synced_at ?? "", render: (a) => dateTime(a.last_synced_at) },
                {
                  key: "sync", label: "Sync", noCsv: true, noPrint: true, value: () => null,
                  render: (a) => (
                    <Button size="sm" disabled={!!busy}
                      onClick={() => act(`sync-${a.customer_id}`, { action: "set_account_sync", customer_id: a.customer_id, sync_enabled: !a.sync_enabled })}>
                      {a.sync_enabled ? "Stop syncing" : "Start syncing"}
                    </Button>
                  ),
                },
              ]}
            />
          </div>
        )}

        <Section title="Add a direct-access account" hint="Only for an account that is not under FF's manager account. Accounts under the MCC appear by themselves on the next sync.">
          <form onSubmit={addAccount} className="no-print grid max-w-2xl gap-3 sm:grid-cols-3">
            <Field label="Customer ID"><input required className={inputClass} value={form.customer_id} onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))} placeholder="123-456-7890" /></Field>
            <Field label="Login customer ID" hint="Empty for direct access.">
              <input className={inputClass} value={form.login_customer_id} onChange={(e) => setForm((f) => ({ ...f, login_customer_id: e.target.value }))} />
            </Field>
            <div className="flex items-end"><Button type="submit" variant="primary" disabled={busy === "add"}>Add account</Button></div>
          </form>
        </Section>
      </div>
    </main>
  );
}
