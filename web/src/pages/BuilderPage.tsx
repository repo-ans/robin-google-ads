import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { actions, type AdAccount, type BuildAdGroup, type CampaignBuild } from "../lib/api";
import { N8nError } from "../lib/n8n";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { customerId, dateTime, moneyMicros } from "../lib/format";
import AppHeader from "../components/AppHeader";
import { Button, Card, ConfirmDialog, ErrorNote, Field, Loading, Notice, Pill, StatusPill, inputClass } from "../components/ui";

type Draft = {
  id?: string;
  customer_id: string;
  template: "A" | "C";
  name: string;
  daily_budget: string;
  bidding_strategy: CampaignBuild["bidding_strategy"];
  geo_targets: { resource_name: string; name: string }[];
  ad_groups: { name: string; final_url: string; phrase: string; exact: string; ads: { headlines: string; descriptions: string; path1: string; path2: string }[] }[];
};

const emptyAd = () => ({ headlines: "", descriptions: "", path1: "", path2: "" });
const emptyGroup = (url = "") => ({ name: "", final_url: url, phrase: "", exact: "", ads: [emptyAd()] });
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function toDraft(b: CampaignBuild): Draft {
  return {
    id: b.id, customer_id: b.customer_id, template: b.template, name: b.name,
    daily_budget: String(b.daily_budget_micros / 1e6), bidding_strategy: b.bidding_strategy, geo_targets: b.geo_targets,
    ad_groups: b.ad_groups.map((g) => ({
      name: g.name, final_url: g.final_url,
      phrase: g.keywords.filter((k) => k.match_type === "PHRASE").map((k) => k.text).join("\n"),
      exact: g.keywords.filter((k) => k.match_type === "EXACT").map((k) => k.text).join("\n"),
      ads: g.ads.map((a) => ({ headlines: a.headlines.join("\n"), descriptions: a.descriptions.join("\n"), path1: a.path1 ?? "", path2: a.path2 ?? "" })),
    })),
  };
}

function toBody(clientId: string, d: Draft) {
  const groups: BuildAdGroup[] = d.ad_groups.map((g) => ({
    name: g.name, final_url: g.final_url,
    keywords: [...lines(g.phrase).map((text) => ({ text, match_type: "PHRASE" as const })), ...lines(g.exact).map((text) => ({ text, match_type: "EXACT" as const }))],
    ads: g.ads.map((a) => ({ headlines: lines(a.headlines), descriptions: lines(a.descriptions), path1: a.path1, path2: a.path2 })),
  }));
  return {
    action: "save_draft", build_id: d.id, client_id: clientId, customer_id: d.customer_id, template: d.template, name: d.name,
    daily_budget: Number(d.daily_budget), bidding_strategy: d.bidding_strategy, geo_targets: d.geo_targets, ad_groups: groups,
  };
}

// Campaign builder (reference build-campaign intake, rebuilt for the SOP).
// FF staff draft campaigns A (at-need, 24/7) and C (preplanning, office hours);
// Rob builds them. Everything is created PAUSED; only Rob enables later.
export default function BuilderPage() {
  const { clientId = "" } = useParams<{ clientId: string }>();
  const { profile } = useAuth();
  const isRob = profile?.role === "rob_admin";
  const [draft, setDraft] = useState<Draft | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmBuild, setConfirmBuild] = useState<CampaignBuild | null>(null);
  const [geoQuery, setGeoQuery] = useState("");
  const [geoResults, setGeoResults] = useState<{ resource_name: string; canonical_name: string }[]>([]);

  const { data, error, loading, reload } = useAsync(async () => {
    const [client, accounts, builds] = await Promise.all([
      supabase.from("clients").select("name, website_url, writes_enabled").eq("id", clientId).maybeSingle(),
      supabase.from("ad_accounts").select("customer_id, descriptive_name, is_test_account, currency_code").eq("client_id", clientId),
      supabase.from("campaign_builds").select("*").eq("client_id", clientId).order("created_at", { ascending: false }),
    ]);
    if (builds.error) throw new Error(builds.error.message);
    return {
      client: client.data as { name: string; website_url: string | null; writes_enabled: boolean } | null,
      accounts: (accounts.data ?? []) as Pick<AdAccount, "customer_id" | "descriptive_name" | "is_test_account" | "currency_code">[],
      builds: builds.data as CampaignBuild[],
    };
  }, [clientId]);

  // Location search as you type (ff-geo-target-suggest), debounced.
  useEffect(() => {
    if (geoQuery.trim().length < 2) return;
    const t = setTimeout(async () => {
      try {
        const r = await actions.geoSuggest(geoQuery.trim());
        setGeoResults(r.suggestions);
      } catch {
        setGeoResults([]);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [geoQuery]);

  function start(template: "A" | "C") {
    const url = data?.client?.website_url ?? "";
    setIssues([]);
    setMessage(null);
    setDraft({
      customer_id: data?.accounts.find((a) => a.is_test_account)?.customer_id ?? data?.accounts[0]?.customer_id ?? "",
      template,
      name: template === "A" ? "A - At-need" : "C - Preplanning",
      daily_budget: "",
      bidding_strategy: "MAXIMIZE_CONVERSIONS",
      geo_targets: [],
      ad_groups: [emptyGroup(url)],
    });
  }

  async function save() {
    if (!draft) return;
    setBusy("save");
    setMessage(null);
    try {
      const r = await actions.build<{ ok: true; build: CampaignBuild | null; issues: string[] }>(toBody(clientId, draft));
      setIssues(r.issues ?? []);
      if (r.build) setDraft(toDraft(r.build));
      setMessage(r.issues?.length ? "Draft saved. Fix the items below before it can be built." : "Draft saved. It is ready for Rob to build.");
      reload();
    } catch (e) {
      setMessage(e instanceof N8nError ? e.message : "Could not save the draft.");
    } finally {
      setBusy(null);
    }
  }

  async function build(b: CampaignBuild) {
    setBusy("build");
    setMessage(null);
    try {
      const r = await actions.build<{ ok: true; message: string }>({ action: "build", build_id: b.id });
      setMessage(r.message);
    } catch (e) {
      setMessage(e instanceof N8nError ? e.message : "The build failed.");
    } finally {
      setBusy(null);
      reload();
    }
  }

  async function remove(b: CampaignBuild) {
    setBusy("delete");
    try {
      await actions.build({ action: "delete_draft", build_id: b.id });
      if (draft?.id === b.id) setDraft(null);
    } catch (e) {
      setMessage(e instanceof N8nError ? e.message : "Could not delete the draft.");
    } finally {
      setBusy(null);
      reload();
    }
  }

  const upd = (f: (d: Draft) => Draft) => setDraft((d) => (d ? f(structuredClone(d)) : d));
  const acct = data?.accounts.find((a) => a.customer_id === draft?.customer_id);

  return (
    <main className="min-h-screen bg-page px-4 py-8 text-ink sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <AppHeader title={`${data?.client?.name ?? "Client"} - campaign builder`} back={{ to: `/dashboard/clients/${clientId}`, label: data?.client?.name ?? "Client" }}
          subtitle="Search only, phrase/exact keywords (5-15 per ad group), max 2 ads per ad group, people in the area only. Built PAUSED - only Rob enables." />
        {error && <div className="mt-6"><ErrorNote message={error} /></div>}
        {loading && !data && <Loading />}
        {message && <p className="mt-4 text-sm text-ink-muted">{message}</p>}

        {data && (
          <>
            {!data.client?.writes_enabled && (
              <div className="mt-6"><Notice tone="info">Writes are off for this client, so builds only run on a Google Ads test account. Rob turns writes on after the test build looks right.</Notice></div>
            )}

            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => start("A")}>New campaign A (at-need, 24/7)</Button>
              <Button variant="primary" onClick={() => start("C")}>New campaign C (preplanning, office hours)</Button>
            </div>

            <div className="mt-6 space-y-2">
              {data.builds.map((b) => (
                <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{b.name} <span className="text-xs text-ink-subtle">({b.template === "A" ? "at-need" : "preplanning"})</span></p>
                    <p className="text-xs text-ink-subtle">
                      {customerId(b.customer_id)} - {moneyMicros(b.daily_budget_micros, data.accounts.find((a) => a.customer_id === b.customer_id)?.currency_code)}/day - {b.ad_groups.length} ad group(s) - updated {dateTime(b.updated_at)}
                    </p>
                    {b.error && <p className="mt-1 text-xs text-danger">{b.error}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill status={b.status} />
                    {(b.status === "draft" || b.status === "error") && (
                      <>
                        <Button size="sm" onClick={() => { setDraft(toDraft(b)); setIssues([]); }}>Edit</Button>
                        {isRob && <Button size="sm" variant="primary" disabled={!!busy} onClick={() => setConfirmBuild(b)}>Build in Google Ads</Button>}
                        <Button size="sm" variant="danger" disabled={!!busy} onClick={() => remove(b)}>Delete draft</Button>
                      </>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            {draft && (
              <Card className="mt-8 p-6">
                <h2 className="text-lg font-semibold">{draft.id ? "Edit draft" : "New draft"} - campaign {draft.template}</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Google Ads account">
                    <select className={inputClass} value={draft.customer_id} onChange={(e) => upd((d) => ({ ...d, customer_id: e.target.value }))}>
                      {data.accounts.map((a) => <option key={a.customer_id} value={a.customer_id}>{a.descriptive_name ?? customerId(a.customer_id)}{a.is_test_account ? " (test account)" : ""}</option>)}
                    </select>
                  </Field>
                  <Field label="Campaign name"><input className={inputClass} value={draft.name} onChange={(e) => upd((d) => ({ ...d, name: e.target.value }))} /></Field>
                  <Field label={`Daily budget (${acct?.currency_code ?? "account currency"})`} hint="Rob approves budgets.">
                    <input type="number" min="1" className={inputClass} value={draft.daily_budget} onChange={(e) => upd((d) => ({ ...d, daily_budget: e.target.value }))} />
                  </Field>
                  <Field label="Bidding">
                    <select className={inputClass} value={draft.bidding_strategy} onChange={(e) => upd((d) => ({ ...d, bidding_strategy: e.target.value as Draft["bidding_strategy"] }))}>
                      <option value="MAXIMIZE_CONVERSIONS">Maximize conversions</option>
                      <option value="MAXIMIZE_CLICKS">Maximize clicks</option>
                      <option value="MANUAL_CPC">Manual CPC</option>
                    </select>
                  </Field>
                </div>

                <div className="mt-6">
                  <Field label="Locations (people in the area)" hint="Type a town or county, then pick it.">
                    <input className={inputClass} value={geoQuery} onChange={(e) => setGeoQuery(e.target.value)} placeholder="Mount Pleasant, SC" />
                  </Field>
                  {geoResults.length > 0 && geoQuery && (
                    <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-line text-sm">
                      {geoResults.map((g) => (
                        <li key={g.resource_name}>
                          <button className="w-full px-3 py-1.5 text-left hover:bg-surface-muted"
                            onClick={() => { upd((d) => ({ ...d, geo_targets: d.geo_targets.some((x) => x.resource_name === g.resource_name) ? d.geo_targets : [...d.geo_targets, { resource_name: g.resource_name, name: g.canonical_name }] })); setGeoQuery(""); setGeoResults([]); }}>
                            {g.canonical_name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {draft.geo_targets.map((g) => (
                      <span key={g.resource_name} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-3 py-1 text-xs">
                        {g.name}
                        <button aria-label={`Remove ${g.name}`} className="text-ink-subtle hover:text-danger" onClick={() => upd((d) => ({ ...d, geo_targets: d.geo_targets.filter((x) => x.resource_name !== g.resource_name) }))}>x</button>
                      </span>
                    ))}
                  </div>
                </div>

                {draft.ad_groups.map((g, gi) => (
                  <div key={gi} className="mt-6 rounded-xl border border-line p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold">Ad group {gi + 1}</h3>
                      {draft.ad_groups.length > 1 && <Button size="sm" variant="danger" onClick={() => upd((d) => ({ ...d, ad_groups: d.ad_groups.filter((_, i) => i !== gi) }))}>Remove ad group</Button>}
                    </div>
                    <div className="mt-3 grid gap-4 sm:grid-cols-2">
                      <Field label="Name"><input className={inputClass} value={g.name} onChange={(e) => upd((d) => { d.ad_groups[gi].name = e.target.value; return d; })} /></Field>
                      <Field label="Landing page"><input className={inputClass} value={g.final_url} onChange={(e) => upd((d) => { d.ad_groups[gi].final_url = e.target.value; return d; })} placeholder="https://" /></Field>
                      <Field label={`Phrase match keywords (${lines(g.phrase).length})`} hint="One per line.">
                        <textarea rows={6} className={inputClass} value={g.phrase} onChange={(e) => upd((d) => { d.ad_groups[gi].phrase = e.target.value; return d; })} />
                      </Field>
                      <Field label={`Exact match keywords (${lines(g.exact).length})`} hint={`One per line. Total must be 5-15 (now ${lines(g.phrase).length + lines(g.exact).length}).`}>
                        <textarea rows={6} className={inputClass} value={g.exact} onChange={(e) => upd((d) => { d.ad_groups[gi].exact = e.target.value; return d; })} />
                      </Field>
                    </div>
                    {g.ads.map((a, ai) => (
                      <div key={ai} className="mt-4 rounded-lg bg-surface-muted p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-semibold">Responsive search ad {ai + 1}</p>
                          {g.ads.length > 1 && <Button size="sm" variant="ghost" onClick={() => upd((d) => { d.ad_groups[gi].ads.splice(ai, 1); return d; })}>Remove ad</Button>}
                        </div>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          <Field label={`Headlines (${lines(a.headlines).length}/15)`} hint="One per line, 30 characters max, 3-15. Calm tone, no emoji.">
                            <textarea rows={6} className={inputClass} value={a.headlines} onChange={(e) => upd((d) => { d.ad_groups[gi].ads[ai].headlines = e.target.value; return d; })} />
                            {lines(a.headlines).filter((h) => h.length > 30).map((h) => <span key={h} className="mt-1 block text-xs text-danger">Too long ({h.length}): {h}</span>)}
                          </Field>
                          <Field label={`Descriptions (${lines(a.descriptions).length}/4)`} hint="One per line, 90 characters max, 2-4.">
                            <textarea rows={6} className={inputClass} value={a.descriptions} onChange={(e) => upd((d) => { d.ad_groups[gi].ads[ai].descriptions = e.target.value; return d; })} />
                            {lines(a.descriptions).filter((h) => h.length > 90).map((h) => <span key={h} className="mt-1 block text-xs text-danger">Too long ({h.length})</span>)}
                          </Field>
                          <Field label="Display path 1"><input maxLength={15} className={inputClass} value={a.path1} onChange={(e) => upd((d) => { d.ad_groups[gi].ads[ai].path1 = e.target.value; return d; })} /></Field>
                          <Field label="Display path 2"><input maxLength={15} className={inputClass} value={a.path2} onChange={(e) => upd((d) => { d.ad_groups[gi].ads[ai].path2 = e.target.value; return d; })} /></Field>
                        </div>
                      </div>
                    ))}
                    {g.ads.length < 2 && <Button size="sm" className="mt-3" onClick={() => upd((d) => { d.ad_groups[gi].ads.push(emptyAd()); return d; })}>+ Second ad</Button>}
                  </div>
                ))}
                <Button className="mt-4" onClick={() => upd((d) => ({ ...d, ad_groups: [...d.ad_groups, emptyGroup(data.client?.website_url ?? "")] }))}>+ Ad group</Button>

                {issues.length > 0 && (
                  <div className="mt-6 rounded-lg border border-warning-line bg-warning-soft p-4 text-sm text-warning">
                    <p className="font-semibold">Before this can be built:</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">{issues.map((i) => <li key={i}>{i}</li>)}</ul>
                  </div>
                )}
                <div className="mt-6 flex flex-wrap justify-end gap-2">
                  <Button onClick={() => setDraft(null)}>Close</Button>
                  <Button variant="primary" disabled={busy === "save"} onClick={save}>{busy === "save" ? "Saving..." : "Save draft"}</Button>
                </div>
                {acct && <p className="mt-2 text-right text-xs text-ink-subtle">{acct.is_test_account ? <Pill tone="info">test account</Pill> : "Live account - needs writes turned on by Rob."}</p>}
              </Card>
            )}
          </>
        )}
      </div>
      {confirmBuild && (
        <ConfirmDialog
          title={`Build "${confirmBuild.name}" in Google Ads?`}
          message="Google checks the whole campaign first (validate only), then creates it in one step - all or nothing. Everything is created PAUSED; enable it in Google Ads when you are ready. Logged in the write log."
          confirmLabel="Build paused campaign"
          busy={busy === "build"}
          onCancel={() => setConfirmBuild(null)}
          onConfirm={() => { const b = confirmBuild; setConfirmBuild(null); build(b); }}
        />
      )}
    </main>
  );
}
