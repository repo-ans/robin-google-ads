import { useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { actions, rpc, type AdAccount, type CaseMatchRun, type ClientTotals } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { CASE_COLUMNS, downloadCaseTemplate, readCaseList, type CaseListSummary, type CaseRow } from "../lib/caseList";
import { customerId, dateTime, int, money, moneyMicros } from "../lib/format";
import AppHeader from "../components/AppHeader";
import DataTable from "../components/DataTable";
import { Button, Card, ConfirmDialog, ErrorNote, Loading, Notice, Pill, inputClass } from "../components/ui";

const lastMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const monthEnd = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};

// Monthly case match (PDF task 6). The case list is read in the browser, sent
// once to n8n, and dropped: only the counts below are kept (case_match_runs).
export default function CaseMatchPage() {
  const { clientId = "" } = useParams<{ clientId: string }>();
  const { profile } = useAuth();
  const isRob = profile?.role === "rob_admin";
  const fileRef = useRef<HTMLInputElement>(null);
  const [account, setAccount] = useState("");
  const [month, setMonth] = useState(lastMonth());
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [summary, setSummary] = useState<CaseListSummary | null>(null);
  const [again, setAgain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, error, loading, reload } = useAsync(async () => {
    const [client, accounts, runs] = await Promise.all([
      supabase.from("clients").select("name, case_value_micros, currency_code").eq("id", clientId).maybeSingle(),
      supabase.from("ad_accounts").select("customer_id, descriptive_name").eq("client_id", clientId),
      supabase.from("case_match_runs").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(200),
    ]);
    if (runs.error) throw new Error(runs.error.message);
    const list = (runs.data ?? []) as CaseMatchRun[];
    // Spend per uploaded month, for cost per signed case.
    const months = [...new Set(list.filter((r) => !r.validate_only).map((r) => r.month.slice(0, 7)))].slice(0, 12);
    const spend: Record<string, ClientTotals | undefined> = {};
    await Promise.all(months.map(async (m) => {
      const t = await rpc<ClientTotals>("dash_client_totals", { p_from: `${m}-01`, p_to: monthEnd(m) });
      spend[m] = t.find((x) => x.client_id === clientId);
    }));
    return {
      name: (client.data?.name as string) ?? "Client",
      caseValue: client.data?.case_value_micros as number | null,
      currency: client.data?.currency_code as string | null,
      accounts: (accounts.data ?? []) as Pick<AdAccount, "customer_id" | "descriptive_name">[],
      runs: list,
      spend,
    };
  }, [clientId]);

  const chosen = account || data?.accounts[0]?.customer_id || "";

  function clearList() {
    setCases(null);
    setSummary(null);
    setAgain(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onFile(file: File | undefined) {
    setMessage(null);
    clearList();
    if (!file) return;
    if (file.size > 2_000_000) {
      setMessage({ ok: false, text: "The file is too big for a monthly case list." });
      return;
    }
    const result = readCaseList(await file.text());
    if ("error" in result) {
      setMessage({ ok: false, text: result.error });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setCases(result.rows);
    setSummary(result.summary);
    if (result.summary.months.length === 1) setMonth(result.summary.months[0]);
  }

  async function run(action: "check" | "upload") {
    if (!cases) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await actions.caseMatch({ action, client_id: clientId, customer_id: chosen, month, again, cases });
      const head = action === "upload" ? "Uploaded to Google Ads." : "Checked with Google Ads - nothing was sent.";
      setMessage({
        ok: true,
        text: `${head} ${r.cases_in} case(s): ${r.accepted} accepted, ${r.rejected} rejected, ${r.skipped} skipped.`,
      });
      if (action === "upload") clearList();
      reload();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "The case match did not run." });
      reload();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const uploads = (data?.runs ?? []).filter((r) => !r.validate_only && r.status !== "refused" && r.status !== "failed");
  const byMonth = new Map<string, { cases: number; accepted: number }>();
  for (const r of uploads) {
    const m = r.month.slice(0, 7);
    const cur = byMonth.get(m) ?? { cases: 0, accepted: 0 };
    byMonth.set(m, { cases: cur.cases + r.cases_in - r.skipped, accepted: cur.accepted + r.accepted });
  }

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <AppHeader title={`${data?.name ?? "Client"} - case match`} back={{ to: `/dashboard/clients/${clientId}`, label: data?.name ?? "Client" }}
          subtitle="Match signed cases to the ads that brought them. The list is sent to Google Ads and never stored - only counts are kept." />
        {error && <div className="mt-6"><ErrorNote message={error} /></div>}
        {loading && !data && <Loading />}
        {data && (
          <>
            <Card className="no-print mt-6 space-y-4 p-6">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-semibold text-ink-muted">Google Ads account</span>
                  <select className={inputClass + " max-w-xs"} value={chosen} onChange={(e) => setAccount(e.target.value)}>
                    {data.accounts.map((a) => <option key={a.customer_id} value={a.customer_id}>{a.descriptive_name ?? customerId(a.customer_id)}</option>)}
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-semibold text-ink-muted">Month the cases were signed</span>
                  <input type="month" className={inputClass + " w-44"} value={month} onChange={(e) => setMonth(e.target.value)} />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs font-semibold text-ink-muted">Case list (CSV)</span>
                  <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
                </label>
                <Button size="sm" onClick={downloadCaseTemplate}>Download template</Button>
              </div>
              <p className="text-xs text-ink-subtle">
                Columns: {CASE_COLUMNS.join(", ")}. case_date is required. No names - a column like "name" refuses the file.
                Email and phone are hashed before they reach Google; nothing from the list is saved. Delete the file after the upload.
              </p>

              {summary && (
                <Notice tone="info">
                  {summary.rows} case(s) read: {summary.withClickId} with a click id, {summary.withEmailOrPhone} with email or phone,
                  {" "}{summary.withCallTime} with a call time.{summary.months.length > 1 ? ` Dates span ${summary.months.join(", ")} - only ${month} is sent.` : ""}
                </Notice>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={!cases || !chosen || busy} onClick={() => run("check")}>{busy ? "Working..." : "Check with Google Ads"}</Button>
                {isRob && (
                  <Button variant="primary" disabled={!cases || !chosen || busy} onClick={() => setConfirming(true)}>Upload to Google Ads</Button>
                )}
                {isRob && (
                  <label className="flex items-center gap-2 text-xs text-ink-muted">
                    <input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} />
                    These are new cases (an earlier upload for this month did not have them)
                  </label>
                )}
                {cases && <Button size="sm" onClick={clearList}>Clear the list</Button>}
              </div>
              {!isRob && <p className="text-xs text-ink-subtle">FF staff can check a list. Rob uploads it.</p>}
              {message && (message.ok ? <Notice tone="info">{message.text}</Notice> : <ErrorNote message={message.text} />)}
            </Card>

            {byMonth.size > 0 && (
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[...byMonth.entries()].map(([m, v]) => {
                  const t = data.spend[m];
                  const cost = t ? Number(t.cost_micros) : null;
                  return (
                    <Card key={m} className="p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{m}</p>
                      <p className="mt-1 text-lg font-semibold">{int(v.cases)} signed case(s)</p>
                      <p className="text-sm text-ink-muted">Spend {cost === null ? "-" : moneyMicros(cost, t?.currency_code)}</p>
                      <p className="text-sm text-ink-muted">
                        Cost per signed case {cost === null || v.cases === 0 ? "-" : moneyMicros(Math.round(cost / v.cases), t?.currency_code)}
                      </p>
                      <p className="text-xs text-ink-subtle">{int(v.accepted)} accepted by Google Ads</p>
                    </Card>
                  );
                })}
              </div>
            )}

            <div className="mt-6">
              <DataTable
                rows={data.runs}
                rowKey={(r) => r.id}
                csvName={`case-match-${clientId}`}
                empty="No case match runs yet."
                columns={[
                  { key: "when", label: "Run", value: (r) => r.created_at, render: (r) => dateTime(r.created_at) },
                  { key: "month", label: "Month", value: (r) => r.month.slice(0, 7) },
                  { key: "kind", label: "Type", value: (r) => (r.validate_only ? "check" : "upload"), render: (r) => (r.validate_only ? <Pill>check</Pill> : <Pill tone="good">upload</Pill>) },
                  { key: "in", label: "Cases", align: "right", value: (r) => r.cases_in },
                  { key: "skipped", label: "Skipped", align: "right", value: (r) => r.skipped },
                  { key: "accepted", label: "Accepted", align: "right", value: (r) => r.accepted },
                  { key: "rejected", label: "Rejected", align: "right", value: (r) => r.rejected },
                  { key: "value", label: "Value", align: "right", value: (r) => Number(r.value_total), render: (r) => money(Number(r.value_total), r.currency_code) },
                  {
                    key: "status", label: "Status", value: (r) => r.status,
                    render: (r) => <Pill tone={r.status === "ok" ? "good" : r.status === "partial" ? "warn" : "bad"}>{r.status}</Pill>,
                  },
                  {
                    key: "reasons", label: "Why some were not matched", value: (r) => Object.entries(r.reasons ?? {}).map(([k, n]) => `${k}: ${n}`).join("; ") + (r.error ? ` ${r.error}` : ""),
                    render: (r) => (
                      <span className="text-xs text-ink-muted">
                        {Object.entries(r.reasons ?? {}).map(([k, n]) => `${k.toLowerCase().replace(/_/g, " ")} (${n})`).join(", ") || "-"}
                        {r.error ? <span className="block text-danger">{r.error}</span> : null}
                      </span>
                    ),
                  },
                ]}
              />
            </div>
          </>
        )}
      </div>

      {confirming && summary && (
        <ConfirmDialog
          title={`Upload ${month} cases to Google Ads?`}
          message={
            <div className="space-y-2">
              <p>{summary.rows} case(s) go to Google Ads as "FF - Signed case" conversions. Google checks them first; every attempt is logged.</p>
              <p>Uploaded conversions cannot be taken back. Upload each case only once.</p>
            </div>
          }
          confirmLabel="Upload"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => run("upload")}
        />
      )}
    </main>
  );
}
