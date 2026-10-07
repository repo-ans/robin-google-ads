import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { actions, type Client } from "../lib/api";
import { N8nError } from "../lib/n8n";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { customerId, dateTime } from "../lib/format";
import { websiteNote, websiteSnippet, type WebsiteValues } from "../lib/websiteCode";
import { Button, ErrorNote, Notice, Pill, Section } from "./ui";

type Tracking = WebsiteValues & {
  customer_id: string;
  descriptive_name: string | null;
  is_test_account: boolean;
  last_synced_at: string | null;
  call_reporting_enabled: boolean;
  call_conversion_reporting_enabled: boolean;
  auto_tagging_enabled: boolean;
  has_ad_call_90: boolean;
  has_website_call_90: boolean;
  has_account_call_asset: boolean;
  search_campaigns_without_call_asset: number;
  has_case_signed: boolean;
  has_form_action: boolean;
  has_purchase_action: boolean;
  has_start_action: boolean;
};
type ListStatus = { customer_id: string; list_name: string | null; list_words: number; search_campaigns: number; campaigns_without_list: number };
type Check = { url: string; checked_at: string; error: string | null; platform: string | null; has_ff_script: boolean; has_gtag: boolean; has_gtm: boolean; has_form: boolean; has_checkout: boolean; checkout_hint: string | null };
type Word = { text: string; theme: string };

type Item = { label: string; ok: boolean; how: string };

// One place for everything the system sets up for a client. Most of it runs by
// itself every day (website check, client type, website, phone, GHL link, search
// sorting, reports). What is left is Rob's one click for Google Ads, and the
// website code for whoever edits the client's site.
export default function ClientSetup({ client, warnings }: { client: Client; warnings: string[] }) {
  const { profile } = useAuth();
  const isRob = profile?.role === "rob_admin";
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [copied, setCopied] = useState(false);
  const { data, error, reload } = useAsync(async () => {
    const [tracking, lists, checks, words] = await Promise.all([
      supabase.from("v_call_tracking").select("*").eq("client_id", client.id).order("customer_id"),
      supabase.from("v_negative_list_status").select("customer_id, list_name, list_words, search_campaigns, campaigns_without_list").eq("client_id", client.id),
      supabase.from("website_checks").select("url, checked_at, error, platform, has_ff_script, has_gtag, has_gtm, has_form, has_checkout, checkout_hint").eq("client_id", client.id).order("url"),
      supabase.from("universal_negatives").select("text, theme").order("theme").order("text"),
    ]);
    if (tracking.error) throw new Error(tracking.error.message);
    return {
      tracking: (tracking.data ?? []) as Tracking[],
      lists: new Map(((lists.data ?? []) as ListStatus[]).map((l) => [l.customer_id, l])),
      checks: (checks.data ?? []) as Check[],
      words: (words.data ?? []) as Word[],
    };
  }, [client.id]);

  const online = client.process === "online_cremation";
  const checks = data?.checks ?? [];
  const okPages = checks.filter((c) => !c.error);
  const codeOnSite = okPages.some((c) => c.has_ff_script);
  const platform = okPages.find((c) => c.platform)?.platform ?? null;

  const accountItems = (t: Tracking): Item[] => {
    const list = data?.lists.get(t.customer_id);
    return [
      { label: "Calls of 90 seconds or more are counted", ok: t.call_reporting_enabled && t.call_conversion_reporting_enabled && t.has_ad_call_90 && t.has_website_call_90, how: "Rob's one click" },
      { label: "Phone number shown on every campaign", ok: t.has_account_call_asset || t.search_campaigns_without_call_asset === 0, how: "Rob's one click" },
      online
        ? { label: "Online arrangements are counted with their amount", ok: t.has_purchase_action && t.has_start_action, how: "Rob's one click" }
        : { label: "Preplanning form requests are counted", ok: t.has_form_action, how: "Rob's one click" },
      { label: "Signed cases can be matched (\"Case signed\")", ok: t.has_case_signed, how: "Rob's one click" },
      { label: "Junk searches blocked on every campaign", ok: Boolean(list?.list_name) && (list?.campaigns_without_list ?? 1) === 0, how: "Rob's one click" },
    ];
  };
  const clientItems: Item[] = [
    { label: "Website found", ok: okPages.length > 0, how: "Found by itself from the ads every day" },
    { label: "FF code on the website", ok: codeOnSite, how: platform === "ghl" ? "FF adds it in GHL (site settings, tracking code)" : "Whoever edits the website - use Copy website code" },
    { label: "GHL sub-account linked", ok: Boolean(client.ghl_location_id), how: "Linked by itself when the name, website or phone matches - or pick it on Edit client" },
  ];
  const missingGoogle = (data?.tracking ?? []).some((t) => accountItems(t).some((i) => !i.ok));
  // Rob's rule: a live account changes only after Rob turns Google Ads writes on for the client.
  const canWrite = client.writes_enabled || (data?.tracking ?? []).every((t) => t.is_test_account);

  async function setUpEverything() {
    setBusy(true);
    setResult(null);
    const lines: string[] = [];
    let ok = true;
    const step = async (label: string, fn: () => Promise<{ steps?: string[]; message?: string }>) => {
      try {
        const r = await fn();
        lines.push(`${label}: ${r.steps?.join("; ") || r.message || "done"}`);
      } catch (e) {
        if (e instanceof N8nError && e.status === 409) lines.push(`${label}: already done`);
        else { ok = false; lines.push(`${label}: ${e instanceof Error ? e.message : "did not work"}`); }
      }
    };
    for (const t of data?.tracking ?? []) {
      const name = t.descriptive_name ?? customerId(t.customer_id);
      await step(`${name} - tracking`, () => actions.setupCallTracking(client.id, t.customer_id));
      await step(`${name} - blocked words`, () => actions.setupNegativeList(client.id, t.customer_id));
    }
    if (client.ghl_location_id) await step("GHL fields", () => actions.ghlSetup("setup", client.id));
    setResult({ ok, lines });
    setBusy(false);
    reload();
  }

  async function copyCode() {
    const t = data?.tracking[0];
    if (!t) return;
    const text = websiteNote(client.name, online, websiteSnippet(t, client.phone, online));
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      window.prompt("Copy the website code and note:", text);
    }
  }

  const row = (i: Item) => (
    <li key={i.label} className="flex items-start gap-2">
      <span className={i.ok ? "text-success" : "text-warning"} aria-hidden>{i.ok ? "✓" : "-"}</span>
      <span className="min-w-0">
        <span className={i.ok ? "" : "font-medium"}>{i.label}</span>
        {!i.ok && <span className="block text-xs text-ink-subtle">{i.how}</span>}
      </span>
    </li>
  );

  return (
    <Section
      title="Setup"
      hint="Checked every day by itself. Only the items marked with a dash need someone."
      actions={
        <>
          {isRob && missingGoogle && canWrite && (
            <Button size="sm" variant="primary" disabled={busy} onClick={setUpEverything}>{busy ? "Setting up..." : "Set up everything"}</Button>
          )}
          {!codeOnSite && data?.tracking[0] && (
            <Button size="sm" onClick={copyCode}>{copied ? "Copied" : "Copy website code"}</Button>
          )}
        </>
      }
    >
      {error && <ErrorNote message={error} />}
      {missingGoogle && !canWrite && (
        <div className="mb-3">
          <Notice>
            <strong>Google Ads writes are off for this client</strong>, so nothing is changed in Google Ads.{" "}
            {isRob ? "Turn them on at the top of the page to use Set up everything." : "Rob turns them on when he is ready."}
          </Notice>
        </div>
      )}
      {result && (
        result.ok
          ? <Notice tone="info">{result.lines.join(" | ")}. The list above updates after the next sync.</Notice>
          : <ErrorNote message={result.lines.join(" | ")} />
      )}

      <div className="card rounded-xl border border-line bg-surface p-4 text-sm">
        <p className="text-ink-muted">
          Client type: <span className="font-medium text-ink">{online ? "Online cremation" : "Funeral home"}</span>
          {" "}{client.process_source === "manual" ? "(set by hand)" : online ? "(online payment found on the website)" : "(no online payment found)"}
          {platform ? ` - website built with ${platform === "ghl" ? "GHL" : platform}` : ""}
        </p>
        <ul className="mt-3 space-y-2">{clientItems.map(row)}</ul>
        {(data?.tracking ?? []).map((t) => (
          <div key={t.customer_id} className="mt-4 border-t border-line pt-3">
            <p className="font-semibold">Google Ads - {t.descriptive_name ?? customerId(t.customer_id)} {t.is_test_account && <Pill tone="info">test</Pill>}</p>
            <ul className="mt-2 space-y-2">{accountItems(t).map(row)}</ul>
            <p className="mt-2 text-xs text-ink-subtle">As of the last sync {dateTime(t.last_synced_at)}.</p>
          </div>
        ))}
        {!isRob && missingGoogle && canWrite && <p className="mt-3 text-xs text-ink-subtle">The Google Ads items are one click for Rob.</p>}
      </div>

      {warnings.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-ink-muted">{warnings.length} thing(s) to look at in Google Ads</summary>
          <ul className="mt-2 space-y-2">{warnings.map((w) => <li key={w}><Notice>{w}</Notice></li>)}</ul>
        </details>
      )}
      {data && data.words.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-ink-muted">Words blocked on every campaign</summary>
          <p className="mt-2 text-ink-muted">
            {data.words.map((w) => w.text).join(", ")}
            {[...(client.own_brand_terms?.length ? client.own_brand_terms : [client.name]), ...(client.competitor_terms ?? [])].length > 0 &&
              `, plus this client's own name and competitors: ${[...(client.own_brand_terms?.length ? client.own_brand_terms : [client.name]), ...(client.competitor_terms ?? [])].map((x) => x.toLowerCase()).join(", ")}`}
          </p>
        </details>
      )}
    </Section>
  );
}
