import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { actions } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { customerId, dateTime } from "../lib/format";
import { Button, ConfirmDialog, ErrorNote, Notice, Pill, Section } from "./ui";

type CallTrackingRow = {
  customer_id: string;
  descriptive_name: string | null;
  is_test_account: boolean;
  last_synced_at: string | null;
  call_reporting_enabled: boolean;
  call_conversion_reporting_enabled: boolean;
  auto_tagging_enabled: boolean;
  has_ad_call_90: boolean;
  has_website_call_90: boolean;
  website_call_send_to: string | null;
  form_send_to: string | null;
  has_account_call_asset: boolean;
  search_campaigns_without_call_asset: number;
};

// The website script for this client, filled from Google Ads (the AW-.../label
// values come from the sync). Arni pastes it once in the site footer.
function websiteSnippet(row: CallTrackingRow, phone: string | null) {
  const sendTo = row.website_call_send_to || row.form_send_to;
  const tagId = sendTo ? sendTo.split("/")[0] : "AW-XXXXXXXXX";
  const lines = [
    `<!-- Google tag (skip if the site already has it for ${tagId}) -->`,
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${tagId}"></script>`,
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${tagId}');</script>`,
    `<!-- FF click id script: keeps the ad click, fills the GHL form, swaps in Google's call tracking number -->`,
    `<script src="${window.location.origin}/ff-click-id.js" defer`,
    ...(row.website_call_send_to && phone ? [`  data-phone-conversion="${row.website_call_send_to}" data-phone="${phone}"`] : []),
    ...(row.form_send_to ? [`  data-form-conversion="${row.form_send_to}" data-thank-you-path="/thank-you-preplanning"`] : []),
    `></script>`,
  ];
  return lines.join("\n");
}

// Call tracking (calls of 90 seconds or more) for every account of a client.
// Status comes from the last sync; Rob sets up whatever is missing with one click.
export default function CallTracking({ clientId, phone }: { clientId: string; phone: string | null }) {
  const { profile } = useAuth();
  const isRob = profile?.role === "rob_admin";
  const [confirm, setConfirm] = useState<CallTrackingRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { data, error } = useAsync(async () => {
    const r = await supabase.from("v_call_tracking").select("*").eq("client_id", clientId).order("customer_id");
    if (r.error) throw new Error(r.error.message);
    return r.data as CallTrackingRow[];
  }, [clientId]);

  async function setUp(row: CallTrackingRow) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await actions.setupCallTracking(clientId, row.customer_id);
      setMsg({ ok: true, text: `${row.descriptive_name ?? customerId(row.customer_id)}: ${r.steps.join("; ")}. ${r.note}` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Call tracking was not set up." });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  async function copy(row: CallTrackingRow) {
    const text = websiteSnippet(row, phone);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(row.customer_id);
    } catch {
      setCopied(null);
      window.prompt("Copy the website script:", text);
    }
  }

  const checks = (r: CallTrackingRow): [string, boolean][] => [
    ["Call reporting on", r.call_reporting_enabled && r.call_conversion_reporting_enabled],
    ["Auto-tagging on", r.auto_tagging_enabled],
    ['"Calls from ads 90s+"', r.has_ad_call_90],
    ['"Calls from website 90s+"', r.has_website_call_90],
    ["Call asset on every campaign", r.has_account_call_asset || r.search_campaigns_without_call_asset === 0],
  ];

  return (
    <Section title="Call tracking" hint="Counts calls of 90 seconds or more - from the ad and from the website. Calls ring straight through: no recording, no menu.">
      {error && <ErrorNote message={error} />}
      {msg && (msg.ok ? <Notice tone="info">{msg.text}</Notice> : <ErrorNote message={msg.text} />)}
      <div className="grid gap-3 md:grid-cols-2">
        {(data ?? []).map((r) => {
          const list = checks(r);
          const missing = list.filter(([, ok]) => !ok).length;
          return (
            <div key={r.customer_id} className="card rounded-xl border border-line bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{r.descriptive_name ?? customerId(r.customer_id)} {r.is_test_account && <Pill tone="info">test</Pill>}</p>
                {missing === 0 ? <Pill tone="good">ready</Pill> : <Pill tone="warn">{missing} to set up</Pill>}
              </div>
              <ul className="mt-3 space-y-1">
                {list.map(([label, ok]) => (
                  <li key={label} className="flex items-center gap-2">
                    <span className={ok ? "text-success" : "text-warning"} aria-hidden>{ok ? "✓" : "-"}</span>
                    <span className={ok ? "" : "text-ink-muted"}>{label}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-subtle">As of the last sync {dateTime(r.last_synced_at)}.</p>
              <div className="no-print mt-3 flex flex-wrap gap-2">
                {isRob && missing > 0 && (
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => setConfirm(r)}>Set up call tracking</Button>
                )}
                <Button size="sm" onClick={() => copy(r)}>{copied === r.customer_id ? "Copied" : "Copy website script"}</Button>
              </div>
              {!isRob && missing > 0 && <p className="mt-2 text-xs text-ink-subtle">Rob sets this up with one click.</p>}
              {!r.website_call_send_to && <p className="mt-2 text-xs text-ink-subtle">The website script gets its call value after setup and the next sync.</p>}
            </div>
          );
        })}
      </div>
      {data && data.length === 0 && <p className="text-sm text-ink-subtle">No Google Ads account is linked to this client yet.</p>}

      {confirm && (
        <ConfirmDialog
          title={`Set up call tracking for ${confirm.descriptive_name ?? customerId(confirm.customer_id)}?`}
          message={
            <div className="space-y-2">
              <p>Only what is missing is changed in Google Ads: call reporting and auto-tagging on; the account's call conversion actions set to count calls of 90 seconds or more (created if there are none); and, if a campaign shows no phone number, a call asset with {phone || "the business phone"} on the whole account.</p>
              <p>Google checks every change first. Every attempt is logged. Nothing records calls.</p>
            </div>
          }
          confirmLabel="Set up"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => setUp(confirm)}
        />
      )}
    </Section>
  );
}
