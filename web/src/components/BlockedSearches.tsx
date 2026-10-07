import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { actions } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useAsync } from "../lib/useAsync";
import { customerId, dateTime, int } from "../lib/format";
import { Button, ConfirmDialog, ErrorNote, Notice, Pill, Section } from "./ui";

type ListStatus = {
  customer_id: string;
  descriptive_name: string | null;
  is_test_account: boolean;
  last_synced_at: string | null;
  list_name: string | null;
  list_words: number;
  search_campaigns: number;
  campaigns_without_list: number;
  blocked_in_triage: number;
  waiting_for_rob: number;
};
type Word = { text: string; match_type: string; theme: string };

const LIST_NAME = "FF - Funeral universal negatives";

// Task 5: one shared blocked-words list on every search campaign of every account,
// plus the weekly sorting of new searches (keep / block / ask Rob).
export default function BlockedSearches({ clientId, clientName, competitors, ownBrand }: {
  clientId: string; clientName: string; competitors: string[]; ownBrand: string[];
}) {
  const { profile } = useAuth();
  const isRob = profile?.role === "rob_admin";
  const [confirm, setConfirm] = useState<ListStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [showWords, setShowWords] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { data, error } = useAsync(async () => {
    const [status, words] = await Promise.all([
      supabase.from("v_negative_list_status").select("*").eq("client_id", clientId).order("customer_id"),
      supabase.from("universal_negatives").select("text, match_type, theme").order("theme").order("text"),
    ]);
    if (status.error) throw new Error(status.error.message);
    if (words.error) throw new Error(words.error.message);
    return { status: status.data as ListStatus[], words: words.data as Word[] };
  }, [clientId]);

  async function run(fn: () => Promise<{ steps?: string[]; note?: string; message?: string }>, label: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fn();
      setMsg({ ok: true, text: `${label}${r.steps ? `: ${r.steps.join("; ")}.` : "."} ${r.note ?? r.message ?? ""}` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "That did not work." });
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const themes = new Map<string, Word[]>();
  for (const w of data?.words ?? []) themes.set(w.theme, [...(themes.get(w.theme) ?? []), w]);
  const names = [...(ownBrand.length ? ownBrand : [clientName]), ...competitors].filter(Boolean);

  return (
    <Section
      title="Blocked searches"
      hint={`The "${LIST_NAME}" list stops ads showing for searches that never become families (obituaries, jobs, products, writing, etiquette, free, the client's own name and competitors). New searches are sorted every Monday: keep, block, or ask Rob.`}
      actions={
        <>
          <Button size="sm" disabled={busy} onClick={() => run(() => actions.searchTriage({ client_id: clientId, days: 30 }), "Sorting started")}>Sort new searches</Button>
          <Button size="sm" onClick={() => setShowWords((x) => !x)}>{showWords ? "Hide the word list" : "Show the word list"}</Button>
        </>
      }
    >
      {error && <ErrorNote message={error} />}
      {msg && (msg.ok ? <Notice tone="info">{msg.text}</Notice> : <ErrorNote message={msg.text} />)}

      <div className="grid gap-3 md:grid-cols-2">
        {(data?.status ?? []).map((r) => {
          const ready = Boolean(r.list_name) && r.campaigns_without_list === 0;
          return (
            <div key={r.customer_id} className="card rounded-xl border border-line bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{r.descriptive_name ?? customerId(r.customer_id)} {r.is_test_account && <Pill tone="info">test</Pill>}</p>
                {ready ? <Pill tone="good">on every campaign</Pill> : <Pill tone="warn">to set up</Pill>}
              </div>
              <ul className="mt-3 space-y-1 text-ink-muted">
                <li>List: {r.list_name ? <span className="text-ink">{r.list_name} - {int(r.list_words)} words</span> : "none yet"}</li>
                <li>Search campaigns without it: <span className="text-ink">{int(r.campaigns_without_list)} of {int(r.search_campaigns)}</span></li>
                <li>Searches marked Block: <span className="text-ink">{int(r.blocked_in_triage)}</span> - waiting for Rob: <span className="text-ink">{int(r.waiting_for_rob)}</span></li>
              </ul>
              <p className="mt-2 text-xs text-ink-subtle">As of the last sync {dateTime(r.last_synced_at)}.</p>
              {isRob && !ready && (
                <div className="no-print mt-3">
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => setConfirm(r)}>Set up blocked-words list</Button>
                </div>
              )}
              {!isRob && !ready && <p className="mt-2 text-xs text-ink-subtle">Rob sets this up with one click.</p>}
            </div>
          );
        })}
      </div>
      {data && data.status.length === 0 && <p className="text-sm text-ink-subtle">No Google Ads account is linked to this client yet.</p>}

      {showWords && data && (
        <div className="card mt-4 rounded-xl border border-line bg-surface p-4 text-sm">
          <p className="font-semibold">Words on the list</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...themes.entries()].map(([theme, words]) => (
              <div key={theme}>
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{theme}</p>
                <p className="mt-1 text-ink-muted">{words.map((w) => w.text).join(", ")}</p>
              </div>
            ))}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">this client</p>
              <p className="mt-1 text-ink-muted">{names.length ? names.map((n) => n.toLowerCase()).join(", ") : "-"}</p>
              <p className="mt-1 text-xs text-ink-subtle">Own name and competitors come from Edit client.</p>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={`Set up the blocked-words list for ${confirm.descriptive_name ?? customerId(confirm.customer_id)}?`}
          message={
            <div className="space-y-2">
              <p>{confirm.list_name ? `Missing words are added to "${confirm.list_name}"` : `"${LIST_NAME}" is created with the FF words`}, plus this client's own name and competitors, and the list is attached to every search campaign that does not have it yet.</p>
              <p>Google checks the change first. Every attempt is logged.</p>
            </div>
          }
          confirmLabel="Set up"
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => run(() => actions.setupNegativeList(clientId, confirm.customer_id), "Done")}
        />
      )}
    </Section>
  );
}
