import { useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { actions, type AdAccount, type Audit } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { customerId, date, dateTime, money } from "../lib/format";
import AppHeader from "../components/AppHeader";
import Markdown from "../components/Markdown";
import { Button, Card, ErrorNote, Loading, Pill, inputClass } from "../components/ui";

// Read-only audit per pilot account (n8n ff-audit writes it from synced data).
// Rob reads it and marks it reviewed. Download .md to commit it to /audits.
export default function AuditPage() {
  const { clientId = "" } = useParams<{ clientId: string }>();
  const { profile } = useAuth();
  const isRob = profile?.role === "rob_admin";
  const [account, setAccount] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, error, loading, reload } = useAsync(async () => {
    const [client, accounts, audits] = await Promise.all([
      supabase.from("clients").select("name, slug").eq("id", clientId).maybeSingle(),
      supabase.from("ad_accounts").select("customer_id, descriptive_name").eq("client_id", clientId),
      supabase.from("audits").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    ]);
    if (audits.error) throw new Error(audits.error.message);
    return {
      name: (client.data?.name as string) ?? "Client",
      slug: (client.data?.slug as string) ?? "client",
      accounts: (accounts.data ?? []) as Pick<AdAccount, "customer_id" | "descriptive_name">[],
      audits: audits.data as Audit[],
    };
  }, [clientId]);

  async function run(fn: () => Promise<{ id?: string }>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fn();
      setMessage(done);
      if (r?.id) setOpenId(r.id);
      reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  function download(a: Audit) {
    const blob = new Blob([a.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${data?.slug ?? "client"}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const selected = data?.audits.find((a) => a.id === openId) ?? data?.audits[0] ?? null;
  const chosen = account || data?.accounts[0]?.customer_id || "";

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <AppHeader title={`${data?.name ?? "Client"} - audit`} back={{ to: `/dashboard/clients/${clientId}`, label: data?.name ?? "Client" }}
          subtitle="Read only: making an audit never changes anything in Google Ads." />
        {error && <div className="mt-6"><ErrorNote message={error} /></div>}
        {loading && !data && <Loading />}
        {data && (
          <>
            <div className="no-print mt-6 flex flex-wrap items-center gap-2">
              <select className={inputClass + " max-w-xs"} value={chosen} onChange={(e) => setAccount(e.target.value)} aria-label="Account">
                {data.accounts.map((a) => <option key={a.customer_id} value={a.customer_id}>{a.descriptive_name ?? customerId(a.customer_id)}</option>)}
              </select>
              <Button variant="primary" disabled={busy || !chosen} className=""
                onClick={() => run(() => actions.audit({ action: "generate", client_id: clientId, customer_id: chosen }), "Audit written.")}>
                {busy ? "Working..." : "Generate audit"}
              </Button>
              {message && <span className="text-sm text-ink-muted">{message}</span>}
            </div>
            {data.accounts.length === 0 && <p className="mt-4 text-sm text-ink-subtle">Link a Google Ads account to this client first.</p>}

            <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_1fr]">
              <div className="no-print space-y-2">
                {data.audits.length === 0 && <p className="text-sm text-ink-subtle">No audits yet.</p>}
                {data.audits.map((a) => (
                  <button key={a.id} onClick={() => setOpenId(a.id)}
                    className={"block w-full rounded-lg border px-3 py-2 text-left text-sm " + (selected?.id === a.id ? "border-accent bg-surface" : "border-line bg-surface hover:bg-surface-muted")}>
                    <p className="font-medium">{date(a.created_at)}</p>
                    <p className="text-xs text-ink-subtle">{customerId(a.customer_id)} - {a.summary.issues ?? 0} issues</p>
                    <p className="mt-1">{a.status === "reviewed_by_rob" ? <Pill tone="good">reviewed by Rob</Pill> : <Pill tone="warn">waiting for Rob</Pill>}</p>
                  </button>
                ))}
              </div>
              {selected && (
                <Card className="p-6">
                  <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-ink-muted">
                      Period {selected.period_from} to {selected.period_to} - spend {money(selected.summary.cost ?? 0, selected.summary.currency)}
                      {selected.reviewed_at && ` - reviewed ${dateTime(selected.reviewed_at)}`}
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => download(selected)}>Download .md</Button>
                      <Button size="sm" onClick={() => window.print()}>Print</Button>
                      {isRob && selected.status === "draft" && (
                        <Button size="sm" variant="primary" disabled={busy}
                          onClick={() => run(() => actions.audit({ action: "review", audit_id: selected.id }), "Marked as reviewed.")}>
                          Mark reviewed
                        </Button>
                      )}
                    </div>
                  </div>
                  <Markdown source={selected.markdown} />
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
